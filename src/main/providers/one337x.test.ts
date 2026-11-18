import { test } from 'node:test'
import assert from 'node:assert/strict'

const LISTING = `<!DOCTYPE html><html><body>
<div class="table-responsive"><table class="table-list table table-striped"><tbody>
<tr class="table-row">
  <td class="coll-1 name"><a href="/torrent/1234567/Some.Release.2024.1080p.WEB-DL">Some.Release.2024.1080p.WEB-DL.x264-GROUP</a></td>
  <td class="coll-date">Aug. 17th '26</td>
  <td class="coll-2 size">1.4 GB</td>
  <td class="coll-3 seeders">42</td>
  <td class="coll-4 leechers">7</td>
</tr>
<tr class="table-row">
  <td class="coll-1 name"><a href="/torrent/1234568/Another.Release.2024.720p.WEB-DL">Another.Release.2024.720p.WEB-DL.x264-GROUP</a></td>
  <td class="coll-date">Sep 1st '24</td>
  <td class="coll-2 size">700 MB</td>
  <td class="coll-3 seeders">15</td>
  <td class="coll-4 leechers">3</td>
</tr>
</tbody></table></div>
</body></html>`

const CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>'

let pageBehaviour: (page: number) => { status: number; body: string } = () => ({
  status: 200,
  body: LISTING
})

test.mock.module('../net/http.ts', {
  namedExports: {
    httpText: async (url: string) => {
      const page = Number(/\/search\/[^/]+\/(\d+)\//.exec(url)?.[1] ?? '1')
      const value = pageBehaviour(page)
      return { ...value, headers: {} }
    },
    httpJson: async () => ({}),
    sanitizeUrl: (u: string) => u
  }
})

const { one337xProvider } = await import('./one337x.ts')

test('1337x parses the listing into rows', async () => {
  pageBehaviour = () => ({ status: 200, body: LISTING })
  const results = await one337xProvider.search({ query: 'Some Release', trackers: ['https://tracker.example/announce'] })
  // Both HTML rows parse; page 2 duplicates the fixture, but both pages feed one list.
  assert.ok(results.length >= 2)
  const first = results[0]
  assert.equal(first.provider, '1337x')
  assert.equal(first.name, 'Some.Release.2024.1080p.WEB-DL.x264-GROUP')
  assert.equal(first.seeders, 42)
  assert.equal(first.size, Math.round(1.4 * 1024 ** 3))
  assert.equal(first.url, 'https://1337x.to/torrent/1234567/Some.Release.2024.1080p.WEB-DL')
  assert.ok(first.addedAt && first.addedAt > 0)
})

test('1337x throws when the listing is a Cloudflare challenge', async () => {
  pageBehaviour = () => ({ status: 200, body: CHALLENGE })
  await assert.rejects(() => one337xProvider.search({ query: 'x', trackers: [] }), /Cloudflare/)
})

test('1337x keeps page-1 results when page 2 fails', async () => {
  pageBehaviour = (page) =>
    page === 1 ? { status: 200, body: LISTING } : { status: 503, body: 'unavailable' }
  const results = await one337xProvider.search({ query: 'x', trackers: [] })
  assert.ok(results.length >= 2)
})

test('1337x throws when page 1 is unavailable', async () => {
  pageBehaviour = () => ({ status: 503, body: 'unavailable' })
  await assert.rejects(() => one337xProvider.search({ query: 'x', trackers: [] }), /HTTP 503/)
})
