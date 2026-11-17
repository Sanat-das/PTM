import path from 'node:path'
import { createRequire } from 'node:module'
import { getUserDataDir } from '../app-paths.ts'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { settings } from '../settings.ts'
import { infoHashFromMagnet } from './magnet.ts'
import type {
  EngineAddInput,
  EngineFile,
  EngineSession,
  TorrentEngine
} from './types.ts'
import { extensionOf, isSubtitleFile, isVideoFile } from './types.ts'

interface WebTorrentClient {
  add: (input: string, opts?: Record<string, unknown>) => unknown
  destroy: (cb?: () => void) => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

interface WebTorrentTorrent {
  infoHash?: string
  name?: string
  files: Array<{ name: string; path: string; length: number }>
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  ready: boolean
  pause?: () => void
  resume?: () => void
  destroy: (cb?: () => void) => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
  createReadStream?: (opts: { start?: number; end?: number }) => AsyncIterable<Uint8Array>
}

/**
 * Built-in engine: runs WebTorrent inside the main process over TCP/UDP and
 * exposes per-file byte ranges so the streaming server can serve them.
 */
export class BuiltinEngine implements TorrentEngine {
  readonly id = 'builtin' as const
  readonly label = 'Built-in (WebTorrent)'

  private client: WebTorrentClient | null = null
  private clientPromise: Promise<WebTorrentClient> | null = null
  private torrents = new Map<string, WebTorrentTorrent>()
  private sessions = new Map<string, EngineSession>()
  private listeners = new Set<(session: EngineSession) => void>()
  private statusTimer: NodeJS.Timeout | null = null

  /**
   * Where finished files land: the configured folder, or the system Downloads
   * folder when nothing is set. Resolved per torrent so a settings change
   * takes effect on the next download without a restart.
   */
  private resolveDownloadDir(): string {
    const configured = settings.get().downloadDir?.trim()
    if (configured) return configured
    try {
      const req = createRequire(import.meta.url)
      const { app } = req('electron') as typeof import('electron')
      return app.getPath('downloads')
    } catch {
      return path.join(getUserDataDir(), 'torrents')
    }
  }

  private async getClient(): Promise<WebTorrentClient> {
    if (this.client) return this.client
    if (this.clientPromise) return this.clientPromise

    this.clientPromise = (async () => {
      const { default: WebTorrent } = await import('webtorrent')
      const client = new WebTorrent({
        dht: true,
        lsd: false,
        tracker: true,
        utp: false,
        webSeeds: true
      }) as unknown as WebTorrentClient

      client.on('error', (error: unknown) => {
        console.error('[engine] client error', (error as Error).message)
      })

      this.client = client
      return client
    })()

    return this.clientPromise
  }

  add(input: EngineAddInput): Promise<EngineSession> {
    return this.addImpl(input)
  }

  private async addImpl(input: EngineAddInput): Promise<EngineSession> {
    const source = input.magnet ?? input.url
    if (!source) throw new Error('No magnet link or torrent URL provided')

    const client = await this.getClient()

    // Dedup by info hash: never hand the swarm the same torrent twice.
    const infoHash = (input.infoHash ?? infoHashFromMagnet(source))?.toLowerCase()
    if (infoHash) {
      const existing = [...this.sessions.values()].find((session) => session.infoHash === infoHash)
      if (existing) {
        if (existing.state !== 'error') {
          // Re-using an already-added torrent, so resume it if the user paused it.
          if (existing.paused) {
            const resumed = await this.setPaused(existing.id, false)
            if (resumed) return resumed
          }
          this.emit(existing)
          return existing
        }
        await this.remove(existing.id)
      }
    }

    const sessionId = randomUUID()

    const session: EngineSession = {
      id: sessionId,
      infoHash,
      name: input.title ?? 'Fetching metadata…',
      files: [],
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      state: 'fetching-metadata',
      paused: false
    }
    this.sessions.set(sessionId, session)

    const torrent = client.add(source, {
      skipVerify: false,
      path: this.resolveDownloadDir()
    }) as unknown as WebTorrentTorrent
    this.torrents.set(sessionId, torrent)

    torrent.on('metadata', () => {
      const current = this.sessions.get(sessionId)
      if (!current) return
      current.infoHash = torrent.infoHash
      current.name = torrent.name ?? current.name
      current.files = torrent.files.map((file, index) => toEngineFile(file, index))
      current.state = torrent.progress >= 1 ? 'complete' : 'ready'
      this.emit(current)
    })

    torrent.on('error', (error: unknown) => {
      const current = this.sessions.get(sessionId)
      if (!current) return
      current.state = 'error'
      current.error = (error as Error).message
      this.emit(current)
    })

    torrent.on('warning', (error: unknown) => {
      console.warn('[engine] warning', (error as Error).message)
    })

    // A swarm that never answers is indistinguishable from a hung spinner,
    // so surface it as an error the UI can act on.
    setTimeout(() => {
      const current = this.sessions.get(sessionId)
      if (!current) return
      if (current.state !== 'fetching-metadata' || current.paused) return
      current.state = 'error'
      current.error =
        'Could not reach any peers for this torrent. Indexes and trackers may be blocked on this network — check Diagnostics.'
      this.emit(current)
    }, 45_000)

    this.startStatusTimer()
    this.emit(session)
    return session
  }

  private startStatusTimer(): void {
    if (this.statusTimer) return
    this.statusTimer = setInterval(() => {
      let changed = false
      for (const [sessionId, torrent] of this.torrents) {
        const session = this.sessions.get(sessionId)
        if (!session) continue
        const progress = torrent.progress ?? 0
        const peers = torrent.numPeers ?? 0
        if (
          Math.abs(progress - session.progress) > 0.001 ||
          Math.abs(peers - session.numPeers) > 0 ||
          torrent.downloadSpeed !== session.downloadSpeed
        ) {
          session.progress = progress
          session.numPeers = peers
          session.downloadSpeed = torrent.downloadSpeed ?? 0
          session.uploadSpeed = torrent.uploadSpeed ?? 0
          if (session.paused) {
            session.state = progress >= 1 ? 'complete' : 'paused'
          } else if (progress < 1 && !torrent.ready) {
            session.state = 'fetching-metadata'
          } else {
            session.state = progress >= 1 ? 'complete' : 'downloading'
          }
          changed = true
          this.emit(session)
        }
      }
      if (!changed && this.torrents.size === 0 && this.statusTimer) {
        clearInterval(this.statusTimer)
        this.statusTimer = null
      }
    }, 1000)
  }

  async remove(sessionId: string): Promise<void> {
    const torrent = this.torrents.get(sessionId)
    if (torrent) {
      await new Promise<void>((resolve) => {
        try {
          torrent.destroy(() => resolve())
        } catch {
          resolve()
        }
      })
      this.torrents.delete(sessionId)
    }
    this.sessions.delete(sessionId)
  }

  async setPaused(sessionId: string, paused: boolean): Promise<EngineSession | undefined> {
    const torrent = this.torrents.get(sessionId)
    if (!torrent) return undefined
    try {
      if (paused) torrent.pause?.()
      else torrent.resume?.()
    } catch (error) {
      console.warn('[engine] could not change pause state', (error as Error).message)
    }
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    session.paused = paused
    session.state = paused
      ? session.progress >= 1
        ? 'complete'
        : 'paused'
      : session.progress >= 1
        ? 'complete'
        : torrent.ready
          ? 'downloading'
          : 'fetching-metadata'
    this.emit(session)
    return session
  }

  list(): EngineSession[] {
    return [...this.sessions.values()]
  }

  get(sessionId: string): EngineSession | undefined {
    return this.sessions.get(sessionId)
  }

  async fileSize(sessionId: string, fileIndex: number): Promise<number> {
    const torrent = this.torrents.get(sessionId)
    if (!torrent) throw new Error('Unknown session')
    return torrent.files[fileIndex]?.length ?? 0
  }

  async createReadStream(
    sessionId: string,
    fileIndex: number,
    range: { start: number; end: number }
  ): Promise<Readable> {
    const torrent = this.torrents.get(sessionId)
    if (!torrent) throw new Error('Unknown session')
    const file = torrent.files[fileIndex]
    if (!file) throw new Error('Unknown file index')

    // WebTorrent v3 exposes an async iterator over the file's byte range.
    const iterator = file as unknown as {
      [Symbol.asyncIterator]: (opts: { start: number; end: number }) => AsyncIterable<Uint8Array>
    }
    const source = iterator[Symbol.asyncIterator]({ start: range.start, end: range.end })

    return Readable.from(
      (async function* () {
        for await (const chunk of source) {
          yield Buffer.from(chunk)
        }
      })()
    )
  }

  onUpdate(cb: (session: EngineSession) => void): void {
    this.listeners.add(cb)
  }

  private emit(session: EngineSession): void {
    for (const listener of this.listeners) listener(session)
  }

  async destroy(): Promise<void> {
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
    for (const sessionId of [...this.torrents.keys()]) {
      await this.remove(sessionId)
    }
    if (this.client) {
      await new Promise<void>((resolve) => this.client?.destroy(() => resolve()))
      this.client = null
    }
  }
}

function toEngineFile(
  file: { name: string; path: string; length: number },
  index: number
): EngineFile {
  const fullPath = file.path || file.name
  const ext = extensionOf(fullPath)
  return {
    index,
    name: file.name || fullPath.split('/').pop() || `file-${index}`,
    path: fullPath,
    size: file.length,
    ext,
    isVideo: isVideoFile(fullPath),
    isSubtitle: isSubtitleFile(fullPath)
  }
}
