import { test } from 'node:test'
import assert from 'node:assert/strict'

const MOVIES = {
  status: 'ok',
  data: {
    movies: [
      {
        id: 10,
        title: 'Some Movie',
        title_long: 'Some Movie 2024',
        year: 2024,
        imdb_code: 'tt1234567',
        genres: ['Drama'],
        date_uploaded: '2024-09-16 12:00:00',
        torrents: [
          {
            url: 'https://yts.mx/torrent/1',
            hash: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
            quality: '1080p',
            seeds: 120,
            peers: 40,
            size: '1.4 GB',
            type: 'web',
            video_codec: 'x264'
          },
          {
            url: 'https://yts.mx/torrent/2',
            hash: 'BBCCAADDEEFF00112233445566778899AABBCCEE',
            quality: '720p',
            seeds: 80,
            peers: 20,
            size: '700 MB',
            type: 'bluray',
            video_codec: 'x264'
          }
        ]
      }
    ]
  }
}

let calls: string[] = []
let mirrorBehaviour: (url: string) => unknown = () => MOVIES

test.mock.module('../net/http.ts', {
  namedExports: {
    httpJson: async (url: string) => {
      calls.push(url)
      const value = mirrorBehaviour(url)
      if (value instanceof Error) throw value
      return value
    },
    httpText: async () => ({ status: 200, body: '', headers: {} }),
    sanitizeUrl: (u: string) => u
  }
})

const { ytsProvider } = await import('./yts.ts')

test('yts flattens movies x torrents and lowercases hashes', async () => {
  calls = []
  mirrorBehaviour = () => MOVIES
  const results = await ytsProvider.search({ query: 'some movie', trackers: ['https://tracker.example/announce'] })
  assert.equal(results.length, 2)
  assert.equal(results[0].infoHash, 'aabbccddeeff00112233445566778899aabbccdd')
  assert.equal(results[0].seeders, 120)
  assert.equal(results[0].size, Math.round(1.4 * 1024 ** 3))
  assert.equal(results[0].imdbId, 'tt1234567')
  // Two torrent qualities for one movie → two flat results.
  assert.deepEqual(
    results.map((r) => r.id),
    ['yts:10-AABBCCDDEEFF00112233445566778899AABBCCDD', 'yts:10-BBCCAADDEEFF00112233445566778899AABBCCEE']
  )
})

test('yts falls back to the next mirror when the first fails', async () => {
  calls = []
  mirrorBehaviour = (url) => (url.startsWith('https://yts.mx') ? new Error('mirror down') : MOVIES)
  const results = await ytsProvider.search({ query: 'some movie', trackers: [] })
  assert.equal(results.length, 2)
  assert.equal(calls.length, 2)
  assert.match(calls[0], /^https:\/\/yts\.mx/)
  assert.match(calls[1], /^https:\/\/yts\.lt/)
})

test('yts throws when every mirror fails', async () => {
  calls = []
  mirrorBehaviour = () => new Error('down')
  await assert.rejects(() => ytsProvider.search({ query: 'x', trackers: [] }), /down/)
})

test('yts returns [] on a non-ok payload', async () => {
  mirrorBehaviour = () => ({ status: 'error', data: {} })
  assert.deepEqual(await ytsProvider.search({ query: 'x', trackers: [] }), [])
})
