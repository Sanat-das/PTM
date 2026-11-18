import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { httpJson, httpText, sanitizeUrl } from './http.ts'

/** Spin a one-shot HTTP server for the duration of a test. */
async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('httpText returns status and body', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    },
    async (baseUrl) => {
      const result = await httpText(`${baseUrl}/`)
      assert.equal(result.status, 200)
      assert.equal(result.body, 'hello')
    }
  )
})

test('httpJson throws on non-2xx responses', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503).end('unavailable')
    },
    async (baseUrl) => {
      await assert.rejects(() => httpJson(`${baseUrl}/`), /HTTP 503/)
    }
  )
})

test('redirects are followed and non-GET requests demote to GET', async () => {
  const seen: Array<{ url: string | undefined; method: string | undefined }> = []
  await withServer(
    (req, res) => {
      seen.push({ url: req.url, method: req.method })
      if (req.url === '/start') {
        res.writeHead(301, { location: '/target' }).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' }).end('final')
    },
    async (baseUrl) => {
      const result = await httpText(`${baseUrl}/start`, { method: 'POST', body: 'payload' })
      assert.equal(result.status, 200)
      assert.equal(result.body, 'final')
    }
  )
  // A 301 demotes POST to GET for the redirect target.
  assert.deepEqual(seen, [
    { url: '/start', method: 'POST' },
    { url: '/target', method: 'GET' }
  ])
})

test('a redirect loop is rejected after the cap', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: '/loop' }).end()
    },
    async (baseUrl) => {
      await assert.rejects(() => httpText(`${baseUrl}/loop`), /Too many redirects/)
    }
  )
})

test('responses larger than maxBytes are aborted', async () => {
  const big = Buffer.alloc(64 * 1024, 'x')
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(big)
    },
    async (baseUrl) => {
      await assert.rejects(() => httpText(`${baseUrl}/`, { maxBytes: 1024 }), /exceeded/)
    }
  )
})

test('a server that never answers hits the absolute deadline', async () => {
  await withServer(
    () => {
      // Never respond.
    },
    async (baseUrl) => {
      await assert.rejects(() => httpText(`${baseUrl}/`, { timeout: 250 }), /timed out/)
    }
  )
})

test('sanitizeUrl redacts credentials in query strings', () => {
  assert.equal(
    sanitizeUrl('https://api.themoviedb.org/3/find/x?api_key=SECRETKEY&external_source=imdb_id'),
    'https://api.themoviedb.org/3/find/x?api_key=%5Bredacted%5D&external_source=imdb_id'
  )
  assert.equal(sanitizeUrl('not a url?api_key=SECRETKEY&x=1'), 'not a url?api_key=[redacted]&x=1')
})
