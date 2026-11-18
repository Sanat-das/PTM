import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { settings } from '../settings.ts'
import { infoHashFromMagnet } from './magnet.ts'
import type { EngineAddInput, EngineFile, EngineSession, TorrentEngine } from './types.ts'
import { extensionOf, isSubtitleFile, isVideoFile, resolveInside, sanitizeRelativePath } from './types.ts'

interface QbtTorrentInfo {
  hash: string
  name: string
  progress: number
  dlspeed: number
  upspeed: number
  num_seeds: number
  num_leechs: number
  state: string
  size: number
  /** Unix seconds; used to adopt hash-less URL-added torrents. */
  added_on?: number
}

interface QbtFile {
  name: string
  size: number
  progress: number
}

interface QbtProperties {
  save_path: string
}

/**
 * Adapter for an installed qBittorrent. Gives the best speeds and real
 * seeding, and lets the user reuse the proxy configuration they already set
 * up in qBittorrent itself.
 */
export class QbittorrentEngine implements TorrentEngine {
  readonly id = 'qbittorrent' as const
  readonly label = 'qBittorrent'

  private cookie: string | null = null
  private sessions = new Map<string, EngineSession>()
  private hashes = new Map<string, string>()
  private listeners = new Set<(session: EngineSession) => void>()
  private poller: NodeJS.Timeout | null = null
  private destroyed = false
  private filesRetryAt = new Map<string, number>()

  private get config() {
    return settings.get().qbittorrent
  }

  private async login(): Promise<void> {
    if (this.cookie) return
    const { url, username, password } = this.config
    const body = new URLSearchParams({ username: username ?? '', password: password ?? '' })
    const response = await fetch(`${url.replace(/\/$/, '')}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!response.ok) throw new Error(`qBittorrent login failed (HTTP ${response.status})`)
    const text = await response.text()
    if (text.trim().toLowerCase().startsWith('fail')) {
      throw new Error('qBittorrent rejected the credentials')
    }
    const setCookie = response.headers.get('set-cookie')
    this.cookie = setCookie ? setCookie.split(';')[0] : null
  }

  private async api<T>(endpoint: string, init?: RequestInit): Promise<T> {
    await this.login()
    const { url } = this.config
    const response = await fetch(`${url.replace(/\/$/, '')}${endpoint}`, {
      signal: AbortSignal.timeout(15000),
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(this.cookie ? { cookie: this.cookie } : {})
      }
    })
    if (response.status === 403) {
      this.cookie = null
      throw new Error('qBittorrent session expired')
    }
    if (!response.ok) throw new Error(`qBittorrent HTTP ${response.status} for ${endpoint}`)
    const text = await response.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }

  async add(input: EngineAddInput): Promise<EngineSession> {
    const source = input.magnet ?? input.url
    if (!source) throw new Error('No magnet link or torrent URL provided')

    const infoHash = (input.infoHash ?? infoHashFromMagnet(source))?.toLowerCase() ?? null

    // Dedup by info hash: reuse an existing session rather than double-adding.
    if (infoHash) {
      const existing = [...this.sessions.values()].find((session) => session.infoHash === infoHash)
      if (existing) {
        if (existing.state !== 'error') {
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

    const { url } = this.config
    const body = new URLSearchParams({ urls: source })
    const savePath = settings.get().downloadDir
    if (savePath) body.set('savepath', savePath)
    body.set('category', 'ptm')

    await this.login()
    const response = await fetch(`${url.replace(/\/$/, '')}/api/v2/torrents/add`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(this.cookie ? { cookie: this.cookie } : {})
      },
      body
    })

    if (response.status === 403) {
      this.cookie = null
      throw new Error('qBittorrent session expired, try again')
    }
    if (!response.ok) {
      throw new Error(`qBittorrent rejected the torrent (HTTP ${response.status})`)
    }
    const reply = (await response.text()).trim().toLowerCase()
    if (reply.startsWith('fail')) {
      // It may already be in qBittorrent from a previous run; adopt it.
      if (infoHash) {
        const torrents = await this.api<QbtTorrentInfo[]>('/api/v2/torrents/info')
        const present = torrents.find((torrent) => torrent.hash.toLowerCase() === infoHash)
        if (present) return this.attach(infoHash, present.name)
      }
      throw new Error('qBittorrent refused to add this torrent')
    }

    return this.attach(infoHash, input.title ?? 'Queued in qBittorrent')
  }

  private attach(infoHash: string | null, name: string): EngineSession {
    const sessionId = randomUUID()
    const session: EngineSession = {
      id: sessionId,
      infoHash: infoHash ?? undefined,
      name,
      files: [],
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      state: 'fetching-metadata',
      paused: false
    }
    this.sessions.set(sessionId, session)
    if (infoHash) this.hashes.set(sessionId, infoHash)
    this.startPolling()
    this.emit(session)
    if (!infoHash) {
      // URL-added torrents carry no hash — adopt it once qBittorrent reports
      // the newcomer so progress/files work instead of erroring blindly at 45s.
      void this.discoverHash(sessionId, Date.now())
    }

    // A torrent qBittorrent never reports would spin forever in the UI.
    setTimeout(() => {
      const current = this.sessions.get(sessionId)
      if (!current) return
      if (current.state !== 'fetching-metadata' || current.paused) return
      current.state = 'error'
      current.error = infoHash
        ? 'qBittorrent did not report this torrent. Check that it is running and reachable.'
        : 'Could not determine this torrent’s info hash, so progress cannot be tracked.'
      this.emit(current)
    }, 45_000).unref?.()

    return session
  }

  /**
   * Best-effort adoption of the info hash for a torrent added by URL (the
   * answer contains no hash). Polls for ~30s and adopts the hash only when
   * exactly one recent torrent is a plausible match — ambiguous cases stay
   * untracked rather than risk attaching to the wrong torrent.
   */
  private async discoverHash(sessionId: string, attachTimeMs: number): Promise<void> {
    const attachSec = Math.floor(attachTimeMs / 1000)
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const session = this.sessions.get(sessionId)
      if (!session || this.destroyed || this.hashes.has(sessionId)) return
      try {
        const torrents = await this.api<QbtTorrentInfo[]>('/api/v2/torrents/info')
        const recent = torrents.filter((t) => (t.added_on ?? 0) >= attachSec - 5)
        let candidate: QbtTorrentInfo | undefined
        if (recent.length === 1) {
          candidate = recent[0]
        } else if (recent.length > 1 && session.name) {
          const name = session.name.toLowerCase()
          const byName = recent.filter((t) => t.name.toLowerCase() === name)
          if (byName.length === 1) candidate = byName[0]
        }
        if (candidate) {
          this.hashes.set(sessionId, candidate.hash.toLowerCase())
          this.emit(session)
          return
        }
      } catch {
        // qBittorrent unreachable — retry until the attempts run out.
      }
    }
  }

  private startPolling(): void {
    if (this.poller) return
    this.poller = setInterval(() => {
      void this.refresh()
    }, 1000)
  }

  private async refresh(): Promise<void> {
    if (this.sessions.size === 0) {
      if (this.poller) {
        clearInterval(this.poller)
        this.poller = null
      }
      return
    }

    try {
      const torrents = await this.api<QbtTorrentInfo[]>('/api/v2/torrents/info')
      if (!Array.isArray(torrents)) throw new Error('unexpected qBittorrent response')
      for (const [sessionId, hash] of this.hashes) {
        const info = torrents.find((t) => t.hash.toLowerCase() === hash)
        const session = this.sessions.get(sessionId)
        if (!session || !info) continue

        session.name = info.name
        session.progress = info.progress
        session.downloadSpeed = info.dlspeed
        session.uploadSpeed = info.upspeed
        session.numPeers = info.num_seeds + info.num_leechs
        session.paused = info.state === 'pausedDL' || info.state === 'pausedUP' || info.state === 'stoppedDL' || info.state === 'stoppedUP'
        session.state =
          session.paused
            ? info.progress >= 1
              ? 'complete'
              : 'paused'
            : info.state === 'error' || info.state === 'missingFiles'
              ? 'error'
              : info.progress >= 1
                ? 'complete'
                : 'downloading'

        if (session.files.length === 0 && info.size > 0) {
          const retryAt = this.filesRetryAt.get(sessionId) ?? 0
          if (Date.now() < retryAt) {
            // Back off after a failure instead of hammering the API every second.
            this.emit(session)
            continue
          }
          try {
            const files = await this.api<QbtFile[]>(`/api/v2/torrents/files?hash=${info.hash}`)
            // File paths from the API are relative to the torrent's save path —
            // resolve them so the downloads library gets absolute paths.
            const props = await this.api<QbtProperties>(
              `/api/v2/torrents/properties?hash=${info.hash}`
            )
            if (Array.isArray(files) && files.length > 0) {
              session.files = files.map((file, index) => {
                const relative = sanitizeRelativePath(file.name)
                const fullPath = props?.save_path
                  ? resolveInside(props.save_path, relative)
                  : relative
                const ext = extensionOf(fullPath)
                return {
                  index,
                  name: path.basename(fullPath),
                  path: fullPath,
                  size: file.size,
                  ext,
                  isVideo: isVideoFile(fullPath),
                  isSubtitle: isSubtitleFile(fullPath)
                } satisfies EngineFile
              })
              this.filesRetryAt.delete(sessionId)
            }
          } catch (error) {
            // Leave session.files empty and retry later — never let one bad
            // fetch abort progress updates for every other session.
            this.filesRetryAt.set(sessionId, Date.now() + 30000)
            console.warn('[qbittorrent] could not list torrent files', (error as Error).message)
          }
        }

        this.emit(session)
      }
    } catch (error) {
      console.warn('[qbittorrent] refresh failed', (error as Error).message)
    }
  }

  async setPaused(sessionId: string, paused: boolean): Promise<EngineSession | undefined> {
    const hash = this.hashes.get(sessionId)
    if (!hash) return undefined
    const body = new URLSearchParams({ hashes: hash })
    const headers = { 'content-type': 'application/x-www-form-urlencoded' }
    let applied = false
    try {
      // qBittorrent 5 renamed pause/resume to stop/start; older builds only
      // understand the legacy endpoints.
      await this.api(paused ? '/api/v2/torrents/stop' : '/api/v2/torrents/start', {
        method: 'POST',
        headers,
        body
      })
      applied = true
    } catch {
      try {
        await this.api(paused ? '/api/v2/torrents/pause' : '/api/v2/torrents/resume', {
          method: 'POST',
          headers,
          body
        })
        applied = true
      } catch (error) {
        console.warn('[qbittorrent] pause change failed', (error as Error).message)
      }
    }
    await this.refresh()
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    if (!applied) {
      // Neither endpoint worked — refresh() reflects qBittorrent's real
      // state; do not pretend the user's click took effect.
      this.emit(session)
      return session
    }
    session.paused = paused
    session.state = paused
      ? session.progress >= 1
        ? 'complete'
        : 'paused'
      : session.progress >= 1
        ? 'complete'
        : 'downloading'
    this.emit(session)
    return session
  }

  async remove(sessionId: string): Promise<void> {
    const hash = this.hashes.get(sessionId)
    if (hash) {
      try {
        await this.api('/api/v2/torrents/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ hashes: hash, deleteFiles: 'false' })
        })
      } catch (error) {
        console.warn('[qbittorrent] delete failed', (error as Error).message)
      }
    }
    this.sessions.delete(sessionId)
    this.hashes.delete(sessionId)
    this.filesRetryAt.delete(sessionId)
  }

  list(): EngineSession[] {
    return [...this.sessions.values()]
  }

  get(sessionId: string): EngineSession | undefined {
    return this.sessions.get(sessionId)
  }

  async fileSize(sessionId: string, fileIndex: number): Promise<number> {
    const session = this.sessions.get(sessionId)
    const file = session?.files[fileIndex]
    if (!file) throw new Error('Unknown file index')
    return file.size
  }

  async createReadStream(
    sessionId: string,
    fileIndex: number,
    range: { start: number; end: number }
  ): Promise<Readable> {
    const hash = this.hashes.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (!hash || !session) throw new Error('Unknown session')

    const file = session.files[fileIndex]
    if (!file) throw new Error('Unknown file index')

    // qBittorrent has no streaming endpoint: reading a partial file would serve
    // missing pieces as zeroes, so wait until the whole torrent is on disk.
    const deadline = Date.now() + 30 * 60 * 1000
    while (Date.now() < deadline) {
      if (this.destroyed || !this.sessions.has(sessionId)) {
        throw new Error('qBittorrent engine was destroyed or the session was removed')
      }
      const torrents = await this.api<QbtTorrentInfo[]>('/api/v2/torrents/info')
      if (!Array.isArray(torrents)) throw new Error('unexpected qBittorrent response')
      const info = torrents.find((torrent) => torrent.hash.toLowerCase() === hash)
      if (!info) throw new Error('qBittorrent no longer has this torrent')
      if (info.state === 'error' || info.state === 'missingFiles') {
        throw new Error('qBittorrent could not download this file')
      }
      if (info.progress >= 1) {
        const props = await this.api<QbtProperties>(`/api/v2/torrents/properties?hash=${hash}`)
        // session.files paths are already absolute; older entries may still be relative.
        const fullPath = path.isAbsolute(file.path)
          ? file.path
          : path.join(props.save_path, file.path)
        const stream = createReadStream(fullPath, { start: range.start, end: range.end })
        await new Promise<void>((resolve, reject) => {
          stream.once('open', () => resolve())
          stream.once('error', reject)
        })
        return stream
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Timed out waiting for qBittorrent to finish the file')
  }

  onUpdate(cb: (session: EngineSession) => void): void {
    this.listeners.add(cb)
  }

  private emit(session: EngineSession): void {
    for (const listener of this.listeners) listener(session)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    if (this.poller) {
      clearInterval(this.poller)
      this.poller = null
    }
    this.sessions.clear()
    this.hashes.clear()
    this.filesRetryAt.clear()
    this.cookie = null
  }
}
