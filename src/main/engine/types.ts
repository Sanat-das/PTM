import type { Readable } from 'node:stream'
import path from 'node:path'

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
  /** The built-in WebTorrent engine, plus a synthetic one serving completed files from disk. */
  readonly id: 'builtin' | 'local'
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

/**
 * Resolve `relativePath` against `baseDir`, keeping the result inside it.
 * Torrent file lists are attacker-controlled: absolute or `..`-escaping
 * entries are clamped to the basename inside the root so downstream sinks
 * (reveal/delete/stream) can never reach outside it.
 */
export function resolveInside(baseDir: string, relativePath: string): string {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, relativePath)
  const rel = path.relative(base, resolved)
  if (rel === '') return resolved
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return resolved
  // Take the final segment on either separator so Windows-style paths clamp
  // correctly on any host platform.
  const baseName = relativePath.split(/[\\/]/).filter(Boolean).pop() || 'file'
  return path.join(base, baseName.replace(/^\.+$/, 'file'))
}

/**
 * Strip drive prefixes, leading slashes and `..` segments from a torrent's
 * relative file path. Used when no base directory is known yet (paths are
 * re-joined against the save path later).
 */
export function sanitizeRelativePath(relativePath: string): string {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter((seg) => seg && seg !== '.' && seg !== '..' && !/^[a-zA-Z]:/.test(seg))
  return segments.join(path.sep)
}

export function extensionOf(name: string): string {
  const clean = name.split('?')[0]
  // Only the final path segment carries an extension — a dotted directory
  // name ("My.Movies/Movie") has none.
  const base = clean.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot === -1) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(name))
}

export function isSubtitleFile(name: string): boolean {
  return SUBTITLE_EXTENSIONS.has(extensionOf(name))
}

/** Containers the browser plays directly without a transcode. */
export const BROWSER_PLAYABLE_EXTENSIONS = new Set(['mp4', 'webm', 'm4v'])
