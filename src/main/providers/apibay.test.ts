import { test } from 'node:test'
import assert from 'node:assert/strict'

const ROWS = [
  {
    id: '1001',
    name: 'Some.Movie.2024.1080p.WEB-DL.x264-GROUP',
    info_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    leechers: '10',
    seeders: '100',
    size: String(1_500_000_000),
    num_files: '2',
    username: 'uploader1',
    added: '1700000000',
    status: 'vip',
    category: '201',
    imdb: 'tt1234567'
  },
  {
    // All-zero hash — providers must drop it (dead row).
    id: '1002',
    name: 'Dead.Torrent.2024.1080p.WEB-DL.x264-GROUP',
    info_hash: '0000000000000000000000000000000000000000',
    leechers: '0',
    seeders: '0',
    size: '0',
    num_files: '1',
    username: 'nobody',
    added: '0',
    status: 'member',
    category: '201',
    imdb: ''
  }
]

let fixture: unknown = []
let lastUrl = ''

test.mock.module('../net/http.ts', {
  namedExports: {
    httpJson: async (url: string) => {
      lastUrl = url
      return fixture
    },
    httpText: async () => ({ status: 200, body: '', headers: {} }),
    sanitizeUrl: (u: string) => u
  }
})

const { apibayProvider } = await import('./apibay.ts')

const baseCtx = {
  query: 'Some Movie',
  trackers: ['https://tracker.example/announce']
}

test('apibay maps rows and drops the all-zero info hash', async () => {
  fixture = ROWS
  const results = await apibayProvider.search({ ...baseCtx })
  assert.equal(results.length, 1)
  const result = results[0]
  assert.equal(result.provider, 'apibay')
  assert.equal(result.id, 'apibay:1001')
  assert.equal(result.seeders, 100)
  assert.equal(result.leechers, 10)
  assert.equal(result.size, 1_500_000_000)
  assert.equal(result.infoHash, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  assert.equal(result.imdbId, 'tt1234567')
  assert.equal(result.fileCount, 2)
  // A magnet is built from the info hash, carrying the trackers.
  assert.match(result.magnet ?? '', /xt=urn:btih:A{40}/)
  assert.match(result.magnet ?? '', /tr=https%3A%2F%2Ftracker\.example%2Fannounce/)
})

test('apibay narrows the query by theme category', async () => {
  fixture = []
  await apibayProvider.search({ ...baseCtx, query: 'test', theme: 'music' })
  assert.match(lastUrl, /cat=100/)
  await apibayProvider.search({ ...baseCtx, query: 'test', theme: 'movies' })
  assert.match(lastUrl, /cat=200/)
})

test('apibay uses an explicit browse category over the theme hint', async () => {
  fixture = []
  await apibayProvider.search({ ...baseCtx, query: '', category: '209', theme: 'movies' })
  assert.match(lastUrl, /cat=209/)
})

test('apibay uses a wildcard query when browsing with no search text', async () => {
  fixture = []
  await apibayProvider.search({ ...baseCtx, query: '', category: '200' })
  const url = new URL(lastUrl)
  assert.equal(url.searchParams.get('q'), '*')
  assert.equal(url.searchParams.get('cat'), '200')
})

test('apibay returns [] when the API answers a non-array payload', async () => {
  fixture = { error: 'something broke' }
  const results = await apibayProvider.search({ ...baseCtx })
  assert.deepEqual(results, [])
})
