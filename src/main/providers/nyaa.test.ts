import { test } from 'node:test'
import assert from 'node:assert/strict'

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>
    <item>
      <title>[SubsPlease] Some Anime - 01 (1080p) [AB12CD34]</title>
      <link>https://nyaa.si/download/12345.torrent</link>
      <guid>https://nyaa.si/view/12345</guid>
      <pubDate>Sat, 16 Nov 2024 10:00:00 +0000</pubDate>
      <nyaa:seeders>42</nyaa:seeders>
      <nyaa:leechers>7</nyaa:leechers>
      <nyaa:infoHash>AB12CD34AB12CD34AB12CD34AB12CD34AB12CD34</nyaa:infoHash>
      <nyaa:size>1.4 GiB</nyaa:size>
      <nyaa:categoryId>1_2</nyaa:categoryId>
    </item>
    <item>
      <title>[Group] Another Entry - 02 (1080p) [EF56GH78]</title>
      <link>https://nyaa.si/download/12346.torrent</link>
      <guid>https://nyaa.si/view/12346</guid>
      <pubDate>Sun, 17 Nov 2024 10:00:00 +0000</pubDate>
      <nyaa:seeders>10</nyaa:seeders>
      <nyaa:leechers>2</nyaa:leechers>
      <nyaa:size>700 MB</nyaa:size>
      <nyaa:categoryId>4_1</nyaa:categoryId>
    </item>
  </channel>
</rss>`

const RSS_SINGLE = RSS.replace(
  /<item>\s*<title>\[Group\] Another Entry[\s\S]*?<\/item>/,
  ''
)

let fixture = RSS

test.mock.module('../net/http.ts', {
  namedExports: {
    httpText: async () => ({ status: 200, body: fixture, headers: {} }),
    httpJson: async () => ({}),
    sanitizeUrl: (u: string) => u
  }
})

const { nyaaProvider } = await import('./nyaa.ts')

const ctx = { query: 'anime', trackers: ['https://tracker.example/announce'] }

test('nyaa parses items, lowercases hashes and builds magnets', async () => {
  fixture = RSS
  const results = await nyaaProvider.search(ctx)
  assert.equal(results.length, 2)

  const [first, second] = results
  assert.equal(first.seeders, 42)
  assert.equal(first.leechers, 7)
  assert.equal(first.infoHash, 'ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34')
  assert.equal(first.theme, 'anime')
  assert.ok((first.magnet ?? '').startsWith('magnet:?xt=urn:btih:ab12cd34'))
  assert.equal(first.size, Math.round(1.4 * 1024 ** 3))

  // No infoHash on the second item — id falls back to the title.
  assert.equal(second.infoHash, undefined)
  assert.equal(second.theme, 'tv')
  assert.equal(second.size, 700 * 1024 ** 2)
})

test('nyaa handles a feed containing a single <item>', async () => {
  fixture = RSS_SINGLE
  const results = await nyaaProvider.search(ctx)
  assert.equal(results.length, 1)
  assert.equal(results[0].seeders, 42)
})

test('nyaa returns [] for a feed without items', async () => {
  fixture = '<?xml version="1.0"?><rss><channel><title>Nyaa</title></channel></rss>'
  const results = await nyaaProvider.search(ctx)
  assert.deepEqual(results, [])
})
