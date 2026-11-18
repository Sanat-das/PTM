import fs from 'node:fs'
import { Readable } from 'node:stream'
import type {
  EngineAddInput,
  EngineSession,
  TorrentEngine
} from './types.ts'
import type { DownloadItem } from '../../shared/types.ts'
import { downloads } from '../downloads.ts'

function sessionFromItem(item: DownloadItem): EngineSession {
  return {
    id: item.id,
    infoHash: item.kind === 'torrent' ? item.infoHash : undefined,
    name: item.title,
    files: item.files.map((file) => ({ ...file })),
    progress: 1,
    downloadSpeed: 0,
    uploadSpeed: 0,
    numPeers: 0,
    state: 'complete',
    paused: false
  }
}

/**
 * Synthetic engine that serves finished downloads straight from disk. It is
 * not switchable — the stream server resolves sessions through it as a
 * fallback for ids that no real engine owns (`file:<hash>` imports, or torrent
 * downloads from a previous run). Only items marked `complete` are served,
 * so partial downloads are never read back as if they were whole.
 */
export class LocalFileEngine implements TorrentEngine {
  readonly id = 'local' as const
  readonly label = 'Local files'

  private listeners = new Set<(session: EngineSession) => void>()

  list(): EngineSession[] {
    return downloads.list()
      .filter((item) => item.status === 'complete')
      .map(sessionFromItem)
  }

  get(sessionId: string): EngineSession | undefined {
    const item = downloads.get(sessionId)
    if (!item || item.status !== 'complete') return undefined
    return sessionFromItem(item)
  }

  async add(_input: EngineAddInput): Promise<EngineSession> {
    throw new Error('Local files cannot be downloaded — add the torrent instead')
  }

  /** Removing a local session keeps the record and the files on disk. */
  async remove(_sessionId: string): Promise<void> {
    // Nothing to tear down: reads are plain fs streams that die with the response.
  }

  async setPaused(_sessionId: string, _paused: boolean): Promise<EngineSession | undefined> {
    return undefined
  }

  async createReadStream(
    sessionId: string,
    fileIndex: number,
    range: { start: number; end: number }
  ): Promise<Readable> {
    const item = downloads.get(sessionId)
    if (!item || item.status !== 'complete') {
      throw new Error('Unknown local file')
    }
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= item.files.length) {
      throw new Error('Unknown file index')
    }
    const file = item.files[fileIndex]
    // A zero-length file has no valid byte range; Node's end: -1 would throw.
    const start = Math.max(0, range.start)
    const end = Math.min(range.end, Math.max(0, file.size - 1))
    if (file.size === 0 || start > end) {
      return Readable.from([])
    }
    return fs.createReadStream(file.path, { start, end })
  }

  async fileSize(sessionId: string, fileIndex: number): Promise<number> {
    const item = downloads.get(sessionId)
    if (!item || item.status !== 'complete') {
      throw new Error('Unknown local file')
    }
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= item.files.length) {
      throw new Error('Unknown file index')
    }
    return item.files[fileIndex].size
  }

  onUpdate(cb: (session: EngineSession) => void): void {
    this.listeners.add(cb)
  }

  async destroy(): Promise<void> {
    this.listeners.clear()
  }
}

export const localFiles = new LocalFileEngine()
