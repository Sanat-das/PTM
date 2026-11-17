import type { Readable } from 'node:stream'

export interface EngineFile {
  index: number
  name: string
  path: string
  size: number
  ext: string
  isVideo: boolean
  isSubtitle: boolean
}

export type EngineState =
  | 'idle'
  | 'fetching-metadata'
  | 'ready'
  | 'downloading'
  | 'paused'
  | 'complete'
  | 'error'

export interface EngineSession {
  id: string
  infoHash?: string
  name: string
  files: EngineFile[]
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  state: EngineState
  paused: boolean
  error?: string
}

export interface EngineAddInput {
  magnet?: string
  url?: string
  title?: string
  /** Known info hash, e.g. from a tracker result that only had a .torrent URL. */
  infoHash?: string
}

export interface TorrentEngine {
  readonly id: 'builtin' | 'qbittorrent'
  readonly label: string
  /** Pause or resume a single torrent. */
  setPaused(sessionId: string, paused: boolean): Promise<EngineSession | undefined>
  add(input: EngineAddInput): Promise<EngineSession>
  remove(sessionId: string): Promise<void>
  list(): EngineSession[]
  get(sessionId: string): EngineSession | undefined
  /** Resolves once the bytes for the given range can be read. */
  createReadStream(
    sessionId: string,
    fileIndex: number,
    range: { start: number; end: number }
  ): Promise<Readable>
  fileSize(sessionId: string, fileIndex: number): Promise<number>
  onUpdate(cb: (session: EngineSession) => void): void
  destroy(): Promise<void>
}

export const VIDEO_EXTENSIONS = new Set([
  'mkv',
  'mp4',
  'avi',
  'mov',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'vob',
  'rmvb',
  'ogv',
  'divx',
  'asf',
  '3gp'
])

export const SUBTITLE_EXTENSIONS = new Set(['srt', 'sub', 'ass', 'ssa', 'vtt', 'idx', 'smi', 'sup'])

export function extensionOf(name: string): string {
  const clean = name.split('?')[0]
  const dot = clean.lastIndexOf('.')
  if (dot === -1) return ''
  return clean.slice(dot + 1).toLowerCase()
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(name))
}

export function isSubtitleFile(name: string): boolean {
  return SUBTITLE_EXTENSIONS.has(extensionOf(name))
}

/** Containers the browser can play without a transcode. */
export const BROWSER_PLAYABLE_EXTENSIONS = new Set(['mp4', 'webm', 'm4v', 'mov'])
