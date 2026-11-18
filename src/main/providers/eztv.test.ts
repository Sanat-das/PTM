import { test } from 'node:test'
import assert from 'node:assert/strict'

const PAYLOAD = {
  torrents: [
    {
      id: 1,
      hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      filename: 'Some.Show.S01E01.1080p.WEB-DL-GROUP.mkv',
      episode_url: 'https://eztv.re/ep/1',
      torrent_url: 'https://eztv.re/torrent/1',
      magnet_url: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Some.Show',
      title: 'Some Show S01E01 1080p',
      imdb_id: '7654321',
      season: '1',
      episode: '1',
      seeds: '25',
      peers: '5',
      size_bytes: String(800_000_000),
      size: '763 MB'
    }
  ]
}

let fixture: unknown = PAYLOAD

test.mock.module('../net/http.ts', {
  namedExports: {
    httpJson: async () => fixture,
    httpText: async () => ({ status: 200, body: '', headers: {} }),
    sanitizeUrl: (u: string) => u
  }
})

const { eztvProvider } = await import('./eztv.ts')

test('eztv does nothing without an imdb id', async () => {
  const results = await eztvProvider.search({ query: 'Some Show', trackers: [] })
  assert.deepEqual(results, [])
})

test('eztv resolves via a tt-prefixed query string', async () => {
  fixture = PAYLOAD
  const results = await eztvProvider.search({ query: 'tt7654321', trackers: [] })
  assert.equal(results.length, 1)
  const result = results[0]
  assert.equal(result.provider, 'eztv')
  assert.equal(result.seeders, 25)
  assert.equal(result.leechers, 5)
  assert.equal(result.size, 800_000_000)
  assert.equal(result.infoHash, 'abcdef0123456789abcdef0123456789abcdef01')
  assert.equal(result.imdbId, '7654321')
})

test('eztv resolves via ctx.imdbId and tolerates a missing torrents array', async () => {
  fixture = { torrents: [] }
  const results = await eztvProvider.search({
    query: 'anything',
    imdbId: 'tt7654321',
    trackers: []
  })
  assert.deepEqual(results, [])

  fixture = {}
  const missing = await eztvProvider.search({
    query: 'anything',
    imdbId: 'tt7654321',
    trackers: []
  })
  assert.deepEqual(missing, [])
})
