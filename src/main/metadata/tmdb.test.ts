import { test } from 'node:test'
import assert from 'node:assert/strict'

let apiKey: string | undefined = 'test-key'
let lastUrl = ''
let payload: unknown = { results: [] }

test.mock.module('../settings.ts', {
  namedExports: {
    settings: { get: () => ({ tmdbApiKey: apiKey }) }
  }
})
test.mock.module('../net/http.ts', {
  namedExports: {
    httpJson: async (url: string) => {
      lastUrl = url
      return payload
    },
    httpText: async () => ({ status: 200, body: '', headers: {} }),
    sanitizeUrl: (url: string) => url
  }
})

const { fetchDiscover } = await import('./tmdb.ts')

test('discover reports an unconfigured TMDB key without calling the API', async () => {
  apiKey = undefined
  const response = await fetchDiscover({ kind: 'movie', sort: 'popular' })
  assert.deepEqual(response, { items: [], configured: false })
  assert.equal(lastUrl, '')
})

test('discover builds the movie URL from the user choices and maps cards', async () => {
  apiKey = 'test-key'
  payload = {
    results: [
      {
        id: 42,
        title: 'A Test Movie',
        release_date: '2024-05-01',
        vote_average: 8.2,
        poster_path: '/poster.jpg',
        overview: 'A synopsis.',
        genre_ids: [28, 878]
      },
      { id: 43, name: 'No Poster Show', first_air_date: '2020-01-01', vote_average: 0 }
    ]
  }

  const response = await fetchDiscover({
    kind: 'movie',
    genreId: 28,
    year: 2024,
    minRating: 7,
    sort: 'rating'
  })

  assert.equal(response.configured, true)
  const url = new URL(lastUrl)
  assert.equal(url.pathname, '/3/discover/movie')
  assert.equal(url.searchParams.get('with_genres'), '28')
  assert.equal(url.searchParams.get('primary_release_year'), '2024')
  assert.equal(url.searchParams.get('vote_average.gte'), '7')
  assert.equal(url.searchParams.get('sort_by'), 'vote_average.desc')
  assert.equal(url.searchParams.get('vote_count.gte'), '100')

  assert.equal(response.items.length, 2)
  assert.equal(response.items[0].title, 'A Test Movie')
  assert.equal(response.items[0].year, 2024)
  assert.equal(response.items[0].rating, 8.2)
  assert.equal(response.items[0].poster, 'https://image.tmdb.org/t/p/w500/poster.jpg')
  assert.deepEqual(response.items[0].genreIds, [28, 878])
  assert.equal(response.items[1].poster, undefined)
  assert.equal(response.items[1].rating, undefined)
})

test('discover passes the requested page through to TMDB', async () => {
  apiKey = 'test-key'
  payload = { results: [] }
  await fetchDiscover({ kind: 'movie', sort: 'popular', page: 3 })
  assert.equal(new URL(lastUrl).searchParams.get('page'), '3')
})

test('discover uses TV year and sort parameters for TV requests', async () => {
  apiKey = 'test-key'
  payload = { results: [] }
  await fetchDiscover({ kind: 'tv', year: 2020, sort: 'newest' })
  const url = new URL(lastUrl)
  assert.equal(url.pathname, '/3/discover/tv')
  assert.equal(url.searchParams.get('first_air_date_year'), '2020')
  assert.equal(url.searchParams.get('primary_release_year'), null)
  assert.equal(url.searchParams.get('sort_by'), 'first_air_date.desc')
})
