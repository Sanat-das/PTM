import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { TorrentEngine } from '../engine/types.ts'
import { makeTempDir, removeTempDir, startHlsTranscode } from './transcode.ts'
import { toVtt } from './subtitles.ts'

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

/** The renderer runs from file:// or the vite dev server, so hls.js needs CORS. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges'
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

  stop(): void {
    for (const session of this.hlsSessions.values()) {
      session.process.kill()
      removeTempDir(session.dir)
    }
    this.hlsSessions.clear()
    this.server?.close()
    this.server = null
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  /** Direct byte-range URL for a torrent file. */
  directUrl(sessionId: string, fileIndex: number): string {
    return `${this.baseUrl}/s/${this.token}/${sessionId}/${fileIndex}`
  }

  /** HLS playlist URL for a torrent file. */
  hlsUrl(sessionId: string, fileIndex: number): string {
    return `${this.baseUrl}/hls/${this.token}/${sessionId}/${fileIndex}/index.m3u8`
  }

  /** WebVTT URL for a subtitle file inside the torrent. */
  subtitleUrl(sessionId: string, fileIndex: number): string {
    return `${this.baseUrl}/sub/${this.token}/${sessionId}/${fileIndex}`
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS).end()
      return
    }

    const url = new URL(req.url ?? '/', this.baseUrl)
    const segments = url.pathname.split('/').filter(Boolean)

    // /s/<token>/<sessionId>/<fileIndex>
    if (segments[0] === 's' && segments.length === 4) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleDirect(req, res, segments[2], Number(segments[3]))
      return
    }

    // /hls/<token>/<sessionId>/<fileIndex>/<file>
    if (segments[0] === 'hls' && segments.length === 5) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleHls(req, res, segments[2], Number(segments[3]), segments[4])
      return
    }

    // /sub/<token>/<sessionId>/<fileIndex>
    if (segments[0] === 'sub' && segments.length === 4) {
      if (segments[1] !== this.token) {
        res.writeHead(403).end('Forbidden')
        return
      }
      await this.handleSubtitle(res, segments[2], Number(segments[3]))
      return
    }

    res.writeHead(404).end('Not found')
  }

  private async handleDirect(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    fileIndex: number
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
        status = 206
      }
    }

    const contentType = MIME_BY_EXTENSION[file.ext] ?? 'application/octet-stream'
    res.writeHead(status, {
      ...CORS_HEADERS,
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
    file: string
  ): Promise<void> {
    const key = `${sessionId}:${fileIndex}`

    if (file === 'index.m3u8') {
      let hls = this.hlsSessions.get(key)
      if (!hls) {
        const engine = this.engineFor(sessionId)
        const session = engine?.get(sessionId)
        if (!engine || !session || !session.files[fileIndex]) {
          res.writeHead(404).end('Unknown session')
          return
        }
        hls = this.createHlsSession(sessionId, fileIndex)
      }

      if (!fs.existsSync(hls.playlistPath)) {
        // Any exit before the playlist exists means the transcode failed
        // (even "success" with no output, e.g. an unreadable input).
        const failure = hls.spawnError ?? (hls.exitCode !== null)
        if (failure) {
          const detail = hls.stderr() || hls.spawnError?.message || `ffmpeg exited (${hls.exitCode})`
          console.error('[stream] transcode failed', detail)
          res.writeHead(502, CORS_HEADERS).end(`Transcode failed: ${detail}`)
          return
        }
        // ffmpeg is still probing the stream; hls.js will retry the playlist.
        res.writeHead(503, { ...CORS_HEADERS, 'retry-after': '1' }).end('Playlist not ready')
        return
      }

      const playlist = fs.readFileSync(hls.playlistPath, 'utf8')
      const rewritten = playlist.replace(/^(seg_[^\n]+)$/gm, (match) =>
        `/hls/${this.token}/${sessionId}/${fileIndex}/${match}`
      )
      res.writeHead(200, {
        ...CORS_HEADERS,
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store'
      })
      res.end(rewritten)
      return
    }

    const hls = this.hlsSessions.get(key)
    if (!hls) {
      res.writeHead(404).end('No HLS session')
      return
    }

    const target = path.join(hls.dir, path.basename(file))
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('Not found')
      return
    }

    // Stream segments instead of reading a whole one into memory; long videos
    // would otherwise allocate megabytes per request.
    const { size } = fs.statSync(target)
    res.writeHead(200, {
      ...CORS_HEADERS,
      'content-type': 'video/mp2t',
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
    fileIndex: number
  ): Promise<void> {
    const engine = this.engineFor(sessionId)
    const session = engine?.get(sessionId)
    const file = session?.files[fileIndex]
    if (!engine || !session || !file) {
      res.writeHead(404).end('Unknown subtitle')
      return
    }
    if (file.ext !== 'srt' && file.ext !== 'vtt') {
      res.writeHead(415, CORS_HEADERS).end('Unsupported subtitle format')
      return
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
      res.writeHead(413, CORS_HEADERS).end('Subtitle file is too large')
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
      res.writeHead(503, { ...CORS_HEADERS, 'retry-after': '1' }).end('Subtitle not ready')
      console.warn('[stream] subtitle read failed', (error as Error).message)
      return
    }

    const vtt = toVtt(text)
    if (!vtt) {
      res.writeHead(415, CORS_HEADERS).end('Unsupported subtitle format')
      return
    }

    res.writeHead(200, {
      ...CORS_HEADERS,
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(vtt)
  }

  private createHlsSession(sessionId: string, fileIndex: number): HlsSession {
    // One transcode at a time per torrent: switching files must not leave the
    // previous ffmpeg reading the same stream.
    this.stopHls(sessionId)

    const key = `${sessionId}:${fileIndex}`
    const dir = makeTempDir()
    const source = this.directUrl(sessionId, fileIndex)

    const { process, playlistPath, stderr } = startHlsTranscode({
      sourceUrl: source,
      outputDir: dir,
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
