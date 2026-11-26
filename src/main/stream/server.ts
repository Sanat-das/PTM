import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { TorrentEngine } from '../engine/types.ts'
import { makeTempDir, removeTempDir, startHlsTranscode } from './transcode.ts'
import { probeCanRemux } from './probe.ts'
import { toVtt } from './subtitles.ts'

/**
 * Cap open-ended range responses. A bare `Range: bytes=0-` would otherwise
 * open a read stream over the entire (multi-GB) file; bounded chunks let the
 * browser start playing after the first piece and seek with small requests.
 */
const MAX_RANGE_BYTES = 8 * 1024 * 1024

interface HlsSession {
  id: string
  key: string
  dir: string
  playlistPath: string
  process: import('node:child_process').ChildProcess
  startedAt: number
  exitCode: number | null
  spawnError?: Error
  stderr: () => string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  ogv: 'video/ogg'
}

/**
 * CORS for hls.js and the <video> element. Only this app's own origins may
 * read responses cross-origin (file:// pages send `Origin: null`; the dev
 * server runs on localhost/127.0.0.1); everything else gets no allow-origin.
 */
const BASE_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges'
}

function corsHeaders(origin?: string): Record<string, string> {
  if (origin && (origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    return { ...BASE_CORS_HEADERS, 'access-control-allow-origin': origin, vary: 'Origin' }
  }
  return BASE_CORS_HEADERS
}

type EngineResolver = (sessionId: string) => TorrentEngine | undefined

/**
 * Local HTTP server that turns torrent files into ordinary HTTP byte-range
 * resources, so the renderer can use a plain <video> element (or hls.js).
 *
 * Binds to 127.0.0.1 and requires a per-launch token on every path.
 */
export class StreamServer {
  private server: http.Server | null = null
  private port = 0
  private readonly token = randomBytes(16).toString('hex')
  private hlsSessions = new Map<string, HlsSession>()

  private readonly engineFor: EngineResolver

  constructor(engineFor: EngineResolver) {
    this.engineFor = engineFor
  }

  async start(): Promise<void> {
    if (this.server) return
    this.sweepStaleTempDirs()
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handle(req, res).catch((error) => {
          console.error('[stream] request failed', error)
          if (!res.headersSent) res.writeHead(500)
          res.end('Internal error')
        })
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.server = server
        const address = server.address()
        this.port = typeof address === 'object' && address ? address.port : 0
        resolve()
      })
    })
  }

  /**
   * HLS transcodes write segments to os.tmpdir(); a crashed run never cleans
   * up. Delete ptm-hls-* directories older than 24h on startup.
   */
  private sweepStaleTempDirs(): void {
    try {
      const tmp = os.tmpdir()
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('ptm-hls-')) continue
        const full = path.join(tmp, entry.name)
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.rmSync(full, { recursive: true, force: true })
          }
        } catch {
          // best effort — never block startup on a sweep
        }
      }
    } catch {
      // tmpdir unreadable — not fatal
    }
  }

  stop(): void {
    for (const session of this.hlsSessions.values()) {
      session.process.kill()
      removeTempDir(session.dir)
    }
    this.hlsSessions.clear()
    this.server?.close()
    this.server = null
    this.port = 0
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  /** Direct byte-range URL for a torrent file. */
  directUrl(sessionId: string, fileIndex: number): string {
    return `${this.baseUrl}/s/${this.token}/${sessionId}/${fileIndex}`
  }

  /**
   * HLS playlist URL for a torrent file. `audioTrack` (an audio-stream
   * ordinal) pins transcoding to that track; switching it starts a fresh
   * transcode on the next request.
   */
  hlsUrl(sessionId: string, fileIndex: number, audioTrack?: number, forceTranscode = false): string {
    const params = new URLSearchParams()
    if (audioTrack !== undefined) params.set('audio', String(audioTrack))
    if (forceTranscode) params.set('transcode', '1')
    const suffix = params.size ? `?${params.toString()}` : ''
    return `${this.baseUrl}/hls/${this.token}/${sessionId}/${fileIndex}/index.m3u8${suffix}`
  }

  /** WebVTT URL for a subtitle file inside the torrent. */
  subtitleUrl(sessionId: string, fileIndex: number): string {
    return `${this.baseUrl}/sub/${this.token}/${sessionId}/${fileIndex}`
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Reject DNS-rebinding style requests whose Host is not loopback.
    const host = req.headers.host
    if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    const cors = corsHeaders(req.headers.origin)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }

    const url = new URL(req.url ?? '/', this.baseUrl)
    const segments = url.pathname.split('/').filter(Boolean)
    // The selected audio track rides as a query param so hls.js keeps it on
    // every segment request without path gymnastics.
    const audioParam = url.searchParams.get('audio')
    const audioTrack =
      audioParam !== null && /^\d+$/.test(audioParam) ? Number(audioParam) : undefined
    const forceTranscode = url.searchParams.get('transcode') === '1'

    // /s/<token>/<sessionId>/<fileIndex>
    if (segments[0] === 's' && segments.length === 4) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleDirect(req, res, segments[2], Number(segments[3]), cors)
      return
    }

    // /hls/<token>/<sessionId>/<fileIndex>/<file>
    if (segments[0] === 'hls' && segments.length === 5) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleHls(req, res, segments[2], Number(segments[3]), segments[4], audioTrack, forceTranscode, cors)
      return
    }

    // /sub/<token>/<sessionId>/<fileIndex>
    if (segments[0] === 'sub' && segments.length === 4) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleSubtitle(res, segments[2], Number(segments[3]), cors)
      return
    }

    res.writeHead(404).end('Not found')
  }

  private async handleDirect(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    fileIndex: number,
    cors: Record<string, string>
  ): Promise<void> {
    const engine = this.engineFor(sessionId)
    const session = engine?.get(sessionId)
    if (!engine || !session) {
      res.writeHead(404).end('Unknown session')
      return
    }
    const file = session.files[fileIndex]
    if (!file) {
      res.writeHead(404).end('Unknown file')
      return
    }

    const total = file.size
    const rangeHeader = req.headers.range

    let start = 0
    let end = total - 1
    let status = 200

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (match) {
        if (match[1]) start = Number(match[1])
        if (match[2]) end = Number(match[2])
        if (!match[1] && match[2]) {
          start = Math.max(0, total - Number(match[2]))
          end = total - 1
        }
        if (start > end || start >= total) {
          res.writeHead(416, { 'content-range': `bytes */${total}` }).end()
          return
        }
        end = Math.min(end, total - 1)
        if (end - start + 1 > MAX_RANGE_BYTES) end = start + MAX_RANGE_BYTES - 1
        status = 206
      }
    }

    const contentType = MIME_BY_EXTENSION[file.ext] ?? 'application/octet-stream'
    res.writeHead(status, {
      ...cors,
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      'cache-control': 'no-store',
      ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${total}` } : {})
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const stream = await engine.createReadStream(sessionId, fileIndex, { start, end })
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }

  private async handleHls(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    fileIndex: number,
    file: string,
    audioTrack: number | undefined,
    forceTranscode: boolean,
    cors: Record<string, string>
  ): Promise<void> {
    const key = `${sessionId}:${fileIndex}:${audioTrack ?? 'default'}:${forceTranscode ? 't' : 'r'}`

    if (file === 'index.m3u8') {
      let hls = this.hlsSessions.get(key)
      if (!hls) {
        const engine = this.engineFor(sessionId)
        const session = engine?.get(sessionId)
        if (!engine || !session || !session.files[fileIndex]) {
          res.writeHead(404).end('Unknown session')
          return
        }
        hls = await this.createHlsSession(sessionId, fileIndex, audioTrack, forceTranscode)
      }

      if (!fs.existsSync(hls.playlistPath)) {
        // Any exit before the playlist exists means the transcode failed
        // (even "success" with no output, e.g. an unreadable input).
        const failure = hls.spawnError ?? (hls.exitCode !== null)
        if (failure) {
          const detail = hls.stderr() || hls.spawnError?.message || `ffmpeg exited (${hls.exitCode})`
          console.error('[stream] transcode failed', detail)
          res.writeHead(502, cors).end('Transcode failed. The file may be corrupt or unsupported.')
          return
        }
        // ffmpeg is still probing the stream; hls.js will retry the playlist.
        res.writeHead(503, { ...cors, 'retry-after': '1' }).end('Playlist not ready')
        return
      }

      const playlist = fs.readFileSync(hls.playlistPath, 'utf8')
      // With temp_file the playlist can appear just before the fMP4 init
      // segment is renamed into place. Don't hand clients a manifest whose
      // EXT-X-MAP target would 404.
      if (playlist.includes('#EXT-X-MAP') && !fs.existsSync(path.join(hls.dir, 'init.mp4'))) {
        res.writeHead(503, { ...cors, 'retry-after': '1' }).end('Init segment not ready')
        return
      }
      const segmentParams = new URLSearchParams()
      if (audioTrack !== undefined) segmentParams.set('audio', String(audioTrack))
      if (forceTranscode) segmentParams.set('transcode', '1')
      const segmentSuffix = segmentParams.size ? `?${segmentParams.toString()}` : ''
      const prefix = `/hls/${this.token}/${sessionId}/${fileIndex}/`
      // fMP4 playlists point at init.mp4 in #EXT-X-MAP; TS playlists do not.
      // Both segment names and the init segment need the tokenised URL.
      const rewritten = playlist
        .replace(/^(#EXT-X-MAP:URI=")([^"]+)(".*)$/gm, (_, before: string, uri: string, after: string) =>
          `${before}${prefix}${path.basename(uri)}${segmentSuffix}${after}`
        )
        .replace(/^(seg_[^\n]+)$/gm, (match) => `${prefix}${match}${segmentSuffix}`)
      res.writeHead(200, {
        ...cors,
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store'
      })
      res.end(rewritten)
      return
    }

    // Only finalized segments are servable — never ffmpeg's temp_file names.
    // Remuxed HLS is fMP4 (init.mp4 + seg_*.m4s); the transcode fallback is TS.
    if (!/^(?:init\.mp4|seg_\d+\.(?:ts|m4s))$/.test(file)) {
      res.writeHead(404).end('Not found')
      return
    }

    const hls = this.hlsSessions.get(key)
    if (!hls) {
      res.writeHead(404).end('No HLS session')
      return
    }

    const target = path.join(hls.dir, file)
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('Not found')
      return
    }

    // Stream segments instead of reading a whole one into memory; long videos
    // would otherwise allocate megabytes per request.
    const { size } = fs.statSync(target)
    res.writeHead(200, {
      ...cors,
      'content-type': file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4',
      'content-length': size,
      'cache-control': 'no-store'
    })
    fs.createReadStream(target)
      .on('error', () => res.destroy())
      .pipe(res)
  }

  private async handleSubtitle(
    res: http.ServerResponse,
    sessionId: string,
    fileIndex: number,
    cors: Record<string, string>
  ): Promise<void> {
    const engine = this.engineFor(sessionId)
    const session = engine?.get(sessionId)
    const file = session?.files[fileIndex]
    if (!engine || !session || !file) {
      res.writeHead(404).end('Unknown subtitle')
      return
    }
    if (file.ext !== 'srt' && file.ext !== 'vtt') {
      res.writeHead(415, cors).end('Unsupported subtitle format')
      return
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
      res.writeHead(413, cors).end('Subtitle file is too large')
      return
    }

    let text: string
    try {
      const stream = await engine.createReadStream(sessionId, fileIndex, {
        start: 0,
        end: file.size - 1
      })
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      text = Buffer.concat(chunks).toString('utf8')
    } catch (error) {
      res.writeHead(503, { ...cors, 'retry-after': '1' }).end('Subtitle not ready')
      console.warn('[stream] subtitle read failed', (error as Error).message)
      return
    }

    const vtt = toVtt(text)
    if (!vtt) {
      res.writeHead(415, cors).end('Unsupported subtitle format')
      return
    }

    res.writeHead(200, {
      ...cors,
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(vtt)
  }

  private async createHlsSession(
    sessionId: string,
    fileIndex: number,
    audioTrack: number | undefined,
    forceTranscode: boolean
  ): Promise<HlsSession> {
    const key = `${sessionId}:${fileIndex}:${audioTrack ?? 'default'}:${forceTranscode ? 't' : 'r'}`
    const dir = makeTempDir()
    const source = this.directUrl(sessionId, fileIndex)

    // Stream-copy when the codecs allow it: the first segment is ready in
    // milliseconds instead of after encoding several seconds of video. An
    // explicit "retry with transcoding" opts out of that shortcut.
    const remux = forceTranscode ? false : await probeCanRemux(source)

    // Start the replacement first; only kill the previous transcode once the
    // new one is running, so a failed spawn keeps the old stream alive.
    let started: ReturnType<typeof startHlsTranscode>
    try {
      started = startHlsTranscode({
        sourceUrl: source,
        outputDir: dir,
        audioIndex: audioTrack,
        remux,
        onExit: (code) => {
          const hls = this.hlsSessions.get(key)
          if (hls) hls.exitCode = code
          if (code !== 0) console.warn('[stream] ffmpeg exited', code)
        },
        onError: (error) => {
          const hls = this.hlsSessions.get(key)
          if (hls) hls.spawnError = error
        }
      })
    } catch (error) {
      removeTempDir(dir)
      throw error
    }

    // One transcode at a time per torrent: switching files or audio tracks
    // must not leave the previous ffmpeg reading the same stream.
    this.stopHls(sessionId)

    const { process, playlistPath, stderr } = started

    const hls: HlsSession = {
      id: sessionId,
      key,
      dir,
      playlistPath,
      process,
      startedAt: Date.now(),
      exitCode: null,
      stderr
    }
    this.hlsSessions.set(key, hls)
    return hls
  }

  /** Stops every transcode belonging to a torrent session. */
  stopHls(sessionId: string): void {
    for (const [key, session] of [...this.hlsSessions]) {
      if (!key.startsWith(`${sessionId}:`)) continue
      session.process.kill()
      removeTempDir(session.dir)
      this.hlsSessions.delete(key)
    }
  }
}
