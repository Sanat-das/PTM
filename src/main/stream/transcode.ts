import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'

export interface TranscodeOptions {
  sourceUrl: string
  outputDir: string
  videoCodec?: string
  crf?: number
  preset?: string
  /** 0-based audio stream ordinal to select; defaults to ffmpeg's pick. */
  audioIndex?: number
  onExit?: (code: number | null) => void
  onError?: (error: Error) => void
}

export interface TranscodeResult {
  process: ChildProcess
  playlistPath: string
  /** Tail of ffmpeg's stderr, used to surface failures to the player. */
  stderr: () => string
}

export function resolveFfmpeg(): string {
  const candidate = ffmpegPath as unknown as string | null
  if (!candidate) return 'ffmpeg'
  // Packaged builds keep the binary outside the asar archive; spawning a path
  // inside it fails with ENOENT even though the file "exists".
  const unpacked = candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  if (unpacked !== candidate && fs.existsSync(unpacked)) return unpacked
  if (fs.existsSync(candidate)) return candidate
  return 'ffmpeg'
}

/**
 * Pipes a remote (torrent-backed) video into an HLS playlist that a browser
 * can play. Used for containers the browser cannot decode natively, MKV being
 * the common case.
 */
export function startHlsTranscode(options: TranscodeOptions): TranscodeResult {
  fs.mkdirSync(options.outputDir, { recursive: true })
  const playlistPath = path.join(options.outputDir, 'index.m3u8')
  const segmentPattern = path.join(options.outputDir, 'seg_%05d.ts')

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-user_agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
    '-i',
    options.sourceUrl,
    // An explicit audio selection must force explicit mapping — ffmpeg's
    // default pick ignores which track the user asked for.
    ...(options.audioIndex !== undefined ? ['-map', '0:v:0?', '-map', `0:a:${options.audioIndex}`] : []),
    '-c:v',
    'libx264',
    '-preset',
    options.preset ?? 'veryfast',
    '-crf',
    String(options.crf ?? 23),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '0',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_filename',
    segmentPattern,
    playlistPath
  ]

  const child = spawn(resolveFfmpeg(), args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  })

  let stderrTail = ''

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (!text) return
    stderrTail = `${stderrTail}\n${text}`.trim().slice(-2000)
    console.warn('[ffmpeg]', text)
  })

  child.on('error', (error) => {
    stderrTail = `${stderrTail}\n${error.message}`.trim()
    console.warn('[ffmpeg] spawn failed', error.message)
    options.onError?.(error)
  })

  child.on('exit', (code) => options.onExit?.(code))

  return { process: child, playlistPath, stderr: () => stderrTail }
}

export function makeTempDir(prefix = 'ptm-hls-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
}
