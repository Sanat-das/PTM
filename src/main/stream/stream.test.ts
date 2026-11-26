import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { StreamServer } from './server.ts'
import type { EngineFile, EngineSession, TorrentEngine } from '../engine/types.ts'

/**
 * Exercises the playback pipeline with a local file standing in for a torrent:
 * byte-range serving and the ffmpeg -> HLS transcode path.
 */

class FakeEngine implements TorrentEngine {
  readonly id = 'builtin' as const
  readonly label = 'fake'
  private paths: string[]
  readonly files: EngineFile[]

  constructor(...filePaths: string[]) {
    this.paths = filePaths
    this.files = filePaths.map((filePath, index) => ({
      index,
      name: path.basename(filePath),
      path: path.basename(filePath),
      size: fs.statSync(filePath).size,
      ext: path.extname(filePath).slice(1).toLowerCase(),
      isVideo: index === 0,
      isSubtitle: index > 0
    }))
  }

  async add(): Promise<EngineSession> {
    throw new Error('not used')
  }
  async remove(): Promise<void> {}
  async setPaused(sessionId: string, _paused: boolean): Promise<EngineSession | undefined> {
    return this.session(sessionId)
  }
  list(): EngineSession[] {
    return [this.session('s1')]
  }
  get(sessionId: string): EngineSession | undefined {
    return sessionId === 's1' ? this.session('s1') : undefined
  }
  async fileSize(): Promise<number> {
    return this.files[0]?.size ?? 0
  }
  onUpdate(): void {}
  async destroy(): Promise<void> {}

  private session(id: string): EngineSession {
    return {
      id,
      name: path.basename(this.paths[0]),
      files: this.files,
      progress: 1,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      state: 'complete',
      paused: false
    }
  }

  async createReadStream(
    _sessionId: string,
    fileIndex: number,
    range: { start: number; end: number }
  ): Promise<Readable> {
    return fs.createReadStream(this.paths[fileIndex], { start: range.start, end: range.end })
  }
}

function makeSampleVideo(dir: string): string {
  const target = path.join(dir, 'sample.mp4')
  execFileSync(
    ffmpegPath as unknown as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=24:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      target
    ],
    { stdio: 'ignore' }
  )
  return target
}

/** An H.265/HEVC MKV, the shape most torrent releases actually arrive in. */
function makeSampleMkv(dir: string): string {
  const target = path.join(dir, 'sample.mkv')
  execFileSync(
    ffmpegPath as unknown as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=24:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-c:v',
      'libx265',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      target
    ],
    { stdio: 'ignore' }
  )
  return target
}

async function waitForPlaylist(
  server: StreamServer,
  playlistUrl: string,
  attempts = 60
): Promise<string> {
  let playlist = ''
  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const response = await fetch(playlistUrl)
    if (response.status !== 200) continue
    playlist = await response.text()
    if (playlist.includes('#EXTINF')) break
  }
  return playlist
}

test('stream server serves byte ranges', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-test-'))
  const video = makeSampleVideo(dir)
  const engine = new FakeEngine(video)
  const server = new StreamServer(() => engine)
  await server.start()
  t.after(() => {
    server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const total = fs.statSync(video).size

  const full = await fetch(server.directUrl('s1', 0))
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(Number(full.headers.get('content-length')), total)
  await full.arrayBuffer()

  const ranged = await fetch(server.directUrl('s1', 0), {
    headers: { range: 'bytes=0-1023' }
  })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), `bytes 0-1023/${total}`)
  const chunk = await ranged.arrayBuffer()
  assert.equal(chunk.byteLength, 1024)

  const tail = await fetch(server.directUrl('s1', 0), {
    headers: { range: 'bytes=-512' }
  })
  assert.equal(tail.status, 206)
  assert.equal((await tail.arrayBuffer()).byteLength, 512)

  const bad = await fetch(server.directUrl('s1', 0), {
    headers: { range: `bytes=${total + 100}-${total + 200}` }
  })
  assert.equal(bad.status, 416)

  // Unknown session is rejected.
  const missing = await fetch(server.directUrl('nope', 0))
  assert.equal(missing.status, 404)

  // The token is required.
  const unauthorised = await fetch(`${server.baseUrl}/s/wrongtoken/s1/0`)
  assert.equal(unauthorised.status, 403)
})

test('open-ended byte ranges are capped to a bounded chunk', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-test-'))
  const big = path.join(dir, 'big.mp4')
  const fd = fs.openSync(big, 'w')
  fs.ftruncateSync(fd, 9 * 1024 * 1024)
  fs.closeSync(fd)
  const engine = new FakeEngine(big)
  const server = new StreamServer(() => engine)
  await server.start()
  t.after(() => {
    server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const total = 9 * 1024 * 1024
  const cap = 8 * 1024 * 1024
  const res = await fetch(server.directUrl('s1', 0), { headers: { range: 'bytes=0-' } })
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('content-range'), `bytes 0-${cap - 1}/${total}`)
  assert.equal((await res.arrayBuffer()).byteLength, cap)
})

test('stream server produces an HLS playlist via ffmpeg', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-test-'))
  const video = makeSampleVideo(dir)
  const engine = new FakeEngine(video)
  const server = new StreamServer(() => engine)
  await server.start()
  t.after(() => {
    server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const playlistUrl = server.hlsUrl('s1', 0)

  // The first request boots the transcoder and asks the client to retry.
  const first = await fetch(playlistUrl)
  assert.equal(first.status, 503)

  const playlist = await waitForPlaylist(server, playlistUrl, 40)
  assert.ok(playlist.includes('#EXTM3U'), 'playlist should be a valid m3u8')
  assert.ok(playlist.includes('#EXTINF'), 'playlist should list segments')

  // H.264/AAC input is stream-copied into fMP4 HLS: the playlist carries an
  // EXT-X-MAP pointing at the init segment, and no re-encode is needed.
  const initMatch = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)
  assert.ok(initMatch, 'playlist should reference an fMP4 init segment')
  assert.ok(initMatch[1].startsWith('/hls/'), 'init segment URL should be tokenised')
  const initResponse = await fetch(`${server.baseUrl}${initMatch[1]}`)
  assert.equal(initResponse.status, 200)
  assert.equal(initResponse.headers.get('content-type'), 'video/mp4')

  // Segment references are rewritten to absolute paths under the stream server.
  const segmentPath = playlist
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /\.(ts|m4s)$/.test(line))
  assert.ok(segmentPath, 'playlist should reference a segment file')

  const segmentResponse = await fetch(`${server.baseUrl}${segmentPath}`)
  assert.equal(segmentResponse.status, 200)
  assert.ok(['video/mp2t', 'video/mp4'].includes(segmentResponse.headers.get('content-type') ?? ''))
  assert.ok((await segmentResponse.arrayBuffer()).byteLength > 0)
})

test('stream server serves subtitles as WebVTT', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-test-'))
  const video = makeSampleVideo(dir)
  const subtitle = path.join(dir, 'sample.eng.srt')
  fs.writeFileSync(
    subtitle,
    ['1', '00:00:01,000 --> 00:00:02,500', 'Hello from the torrent', ''].join('\r\n')
  )
  const engine = new FakeEngine(video, subtitle)
  const server = new StreamServer(() => engine)
  await server.start()
  t.after(() => {
    server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const response = await fetch(server.subtitleUrl('s1', 1))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/vtt/)
  const body = await response.text()
  assert.ok(body.startsWith('WEBVTT\n\n'))
  assert.ok(body.includes('00:00:01.000 --> 00:00:02.500'))
  assert.ok(body.includes('Hello from the torrent'))

  const missing = await fetch(server.subtitleUrl('s1', 99))
  assert.equal(missing.status, 404)

  // A video file is not a subtitle.
  const notSubtitle = await fetch(server.subtitleUrl('s1', 0))
  assert.equal(notSubtitle.status, 415)
})

test('stream server transcodes an H.265 MKV to HLS', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-test-'))
  const mkv = makeSampleMkv(dir)
  const engine = new FakeEngine(mkv)
  const server = new StreamServer(() => engine)
  await server.start()
  t.after(() => {
    server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const playlistUrl = server.hlsUrl('s1', 0)
  const first = await fetch(playlistUrl)
  assert.equal(first.status, 503)

  const playlist = await waitForPlaylist(server, playlistUrl, 60)
  assert.ok(playlist.includes('#EXTM3U'), 'playlist should be a valid m3u8')
  assert.ok(playlist.includes('#EXTINF'), 'playlist should list segments')

  const segmentPath = playlist
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.endsWith('.ts'))
  assert.ok(segmentPath, 'playlist should reference a segment file')

  const segmentResponse = await fetch(`${server.baseUrl}${segmentPath}`)
  assert.equal(segmentResponse.status, 200)
  assert.ok((await segmentResponse.arrayBuffer()).byteLength > 0)
})
