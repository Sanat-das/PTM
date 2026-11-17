import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setUserDataDir } from '../app-paths.ts'
import { settings } from '../settings.ts'
import { QbittorrentEngine } from './qbittorrent.ts'
import type { EngineSession } from './types.ts'

/**
 * Drives the qBittorrent adapter against a stub of its Web API, so the
 * proxied-engine path is covered without a real qBittorrent install.
 */

const INFO_HASH = '08ada5a7a6183aae1e09d831df6748d566095a10'
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}&dn=Sintel`

interface StubState {
  cookie?: string
  torrents: Array<Record<string, unknown>>
  files: Array<{ name: string; size: number; progress: number }>
  savePath: string
  deleted: string[]
  added: string[]
}

function startStub(state: StubState): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const respond = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, headers)
      res.end(body)
    }

    if (url.pathname === '/api/v2/auth/login') {
      state.cookie = 'SID=stub'
      respond(200, 'Ok.', { 'set-cookie': 'SID=stub; HttpOnly; path=/' })
      return
    }

    const cookie = req.headers.cookie ?? ''
    if (state.cookie && !cookie.includes(state.cookie)) {
      respond(403, 'Forbidden')
      return
    }

    if (url.pathname === '/api/v2/torrents/add') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        state.added.push(body)
        respond(200, 'Ok.')
      })
      return
    }

    if (url.pathname === '/api/v2/torrents/info') {
      respond(200, JSON.stringify(state.torrents), { 'content-type': 'application/json' })
      return
    }

    if (url.pathname === '/api/v2/torrents/files') {
      respond(200, JSON.stringify(state.files), { 'content-type': 'application/json' })
      return
    }

    if (url.pathname === '/api/v2/torrents/properties') {
      respond(200, JSON.stringify({ save_path: state.savePath }), {
        'content-type': 'application/json'
      })
      return
    }

    if (url.pathname === '/api/v2/torrents/pause' || url.pathname === '/api/v2/torrents/resume') {
      const pause = url.pathname.endsWith('/pause')
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const params = new URLSearchParams(body)
        const hashes = (params.get('hashes') ?? '').split('|')
        state.torrents = state.torrents.map((t) =>
          hashes.includes(String(t.hash))
            ? { ...t, state: t.progress === 1 || (pause && t.state === 'uploading') ? t.state : pause ? 'pausedDL' : 'downloading' }
            : t
        )
        respond(200, '')
      })
      return
    }

    if (url.pathname === '/api/v2/torrents/delete') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const params = new URLSearchParams(body)
        state.deleted.push(params.get('hashes') ?? '')
        state.torrents = state.torrents.filter((t) => t.hash !== params.get('hashes'))
        respond(200, '')
      })
      return
    }

    respond(404, 'Not Found')
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

function makeEngine(): QbittorrentEngine {
  return new QbittorrentEngine()
}

test('adapter logs in, queues the magnet and polls state', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-qbt-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const state: StubState = {
    torrents: [],
    files: [{ name: 'Sintel/Sintel.mkv', size: 1_000_000, progress: 1 }],
    savePath: 'D:/Media',
    deleted: [],
    added: []
  }
  const { url, close } = await startStub(state)
  t.after(close)

  settings.set({
    qbittorrent: { url, username: 'u', password: 'p' },
    downloadDir: 'D:/Media/PTM'
  })

  const engine = makeEngine()
  t.after(() => engine.destroy())

  const session = await engine.add({ magnet: MAGNET, title: 'Sintel' })
  assert.equal(session.state, 'fetching-metadata')
  assert.equal(session.infoHash, INFO_HASH)
  assert.equal(session.id, engine.list()[0].id)

  // The magnet was sent, and the save path came from settings.
  assert.equal(state.added.length, 1)
  const sent = new URLSearchParams(state.added[0])
  assert.equal(sent.get('urls'), MAGNET)
  assert.equal(sent.get('savepath'), 'D:/Media/PTM')
  assert.equal(sent.get('category'), 'ptm')

  // Simulate qBittorrent picking the torrent up.
  state.torrents.push({
    hash: INFO_HASH,
    name: 'Sintel',
    progress: 0.42,
    dlspeed: 1024,
    upspeed: 256,
    num_seeds: 12,
    num_leechs: 3,
    state: 'downloading',
    size: 1_000_000
  })

  await waitFor(() => engine.get(session.id)?.progress === 0.42, 3000)
  const updated = engine.get(session.id)
  assert.ok(updated)
  assert.equal(updated.name, 'Sintel')
  assert.equal(updated.numPeers, 15)
  assert.equal(updated.downloadSpeed, 1024)
  assert.equal(updated.state, 'downloading')

  // File list arrives once the torrent has started.
  await waitFor(() => (engine.get(session.id)?.files.length ?? 0) === 1, 3000)
  const file = engine.get(session.id)?.files[0]
  assert.ok(file)
  assert.equal(file.name, 'Sintel.mkv')
  assert.equal(file.ext, 'mkv')
  assert.equal(file.isVideo, true)
  assert.equal(file.size, 1_000_000)
  assert.equal(await engine.fileSize(session.id, 0), 1_000_000)

  // Completion is reflected.
  state.torrents[0].progress = 1
  state.torrents[0].state = 'uploading'
  await waitFor(() => engine.get(session.id)?.state === 'complete', 3000)
})

test('adapter removes the torrent from qBittorrent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-qbt-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const state: StubState = {
    torrents: [],
    files: [],
    savePath: 'D:/Media',
    deleted: [],
    added: []
  }
  const { url, close } = await startStub(state)
  t.after(close)

  settings.set({ qbittorrent: { url, username: 'u', password: 'p' } })

  const engine = makeEngine()
  t.after(() => engine.destroy())

  const session = await engine.add({ magnet: MAGNET })
  await engine.remove(session.id)

  assert.equal(state.deleted.length, 1)
  assert.equal(state.deleted[0], INFO_HASH)
  assert.equal(engine.list().length, 0)
})

test('adapter streams a finished file from disk with byte ranges', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-qbt-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const savePath = path.join(dir, 'Media')
  const videoDir = path.join(savePath, 'Sintel')
  fs.mkdirSync(videoDir, { recursive: true })
  const videoPath = path.join(videoDir, 'Sintel.mkv')
  const bytes = Buffer.alloc(4096)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  fs.writeFileSync(videoPath, bytes)

  const state: StubState = {
    torrents: [
      {
        hash: INFO_HASH,
        name: 'Sintel',
        progress: 1,
        dlspeed: 0,
        upspeed: 0,
        num_seeds: 1,
        num_leechs: 0,
        state: 'uploading',
        size: bytes.length
      }
    ],
    files: [{ name: 'Sintel/Sintel.mkv', size: bytes.length, progress: 1 }],
    savePath,
    deleted: [],
    added: []
  }
  const { url, close } = await startStub(state)
  t.after(close)

  settings.set({ qbittorrent: { url, username: 'u', password: 'p' } })

  const engine = makeEngine()
  t.after(() => engine.destroy())

  const session = await engine.add({ magnet: MAGNET })
  await waitFor(() => (engine.get(session.id)?.files.length ?? 0) === 1, 3000)

  const stream = await engine.createReadStream(session.id, 0, { start: 100, end: 199 })
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const received = Buffer.concat(chunks)

  assert.equal(received.length, 100)
  assert.deepEqual(received, bytes.subarray(100, 200))
})

test('adapter pauses and resumes a torrent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-qbt-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const state: StubState = {
    torrents: [
      {
        hash: INFO_HASH,
        name: 'Sintel',
        progress: 0.2,
        dlspeed: 1024,
        upspeed: 0,
        num_seeds: 1,
        num_leechs: 0,
        state: 'downloading',
        size: 1_000_000
      }
    ],
    files: [],
    savePath: 'D:/Media',
    deleted: [],
    added: []
  }
  const { url, close } = await startStub(state)
  t.after(close)

  settings.set({ qbittorrent: { url, username: 'u', password: 'p' } })

  const engine = makeEngine()
  t.after(() => engine.destroy())

  const session = await engine.add({ magnet: MAGNET })
  await waitFor(() => engine.get(session.id)?.state === 'downloading', 3000)

  const paused = await engine.setPaused(session.id, true)
  assert.ok(paused, 'pause should return the session')
  assert.equal(paused.paused, true)
  assert.equal(paused.state, 'paused')
  assert.equal(state.torrents[0].state, 'pausedDL')

  const resumed = await engine.setPaused(session.id, false)
  assert.ok(resumed, 'resume should return the session')
  assert.equal(resumed.paused, false)
  assert.notEqual(resumed.state, 'paused')
})

test('adapter reports bad credentials', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-qbt-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('Fails.')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const url = `http://127.0.0.1:${port}`
  t.after(() => server.close())

  settings.set({ qbittorrent: { url, username: 'u', password: 'wrong' } })

  const engine = makeEngine()
  t.after(() => engine.destroy())

  await assert.rejects(() => engine.add({ magnet: MAGNET }), /credentials/i)
})

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for state'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

export type { EngineSession }
