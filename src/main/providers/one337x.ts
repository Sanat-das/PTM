import { httpText } from '../net/http.ts'
import { emptyHealth, toResult, type ProviderSearchContext, type TorrentProvider } from './types.ts'
import { parseRssDate, parseSizeToBytes } from './util.ts'

interface Row {
  url: string
  name: string
  size: string
  seeders: string
  leechers: string
  addedAt?: number
}

const MAX_PAGES = 2

const ROW_RE =
  /<tr class="table-row">([\s\S]*?)<\/tr>/g
const LINK_RE = /<a href="(\/torrent\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/
const CELL_RE = /<td[^>]*class="coll-2 size"[^>]*>([\s\S]*?)<\/td>/
const SEED_RE = /<td[^>]*class="coll-3 seeders"[^>]*>([\s\S]*?)<\/td>/
const LEECH_RE = /<td[^>]*class="coll-4 leechers"[^>]*>([\s\S]*?)<\/td>/
const DATE_RE = /<td[^>]*class="coll-date"[^>]*>([\s\S]*?)<\/td>/

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** Cloudflare serves a challenge page with HTTP 200; empty results would hide it. */
function assertNotChallenge(html: string): void {
  if (/<title>\s*Just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
    throw new Error(
      '1337x is blocking automated requests (Cloudflare challenge). Enable the proxy or disable this provider.'
    )
  }
}

function parseRows(html: string): Row[] {
  const rows: Row[] = []
  let match: RegExpExecArray | null

  ROW_RE.lastIndex = 0
  while ((match = ROW_RE.exec(html)) !== null) {
    const block = match[1]
    const link = LINK_RE.exec(block)
    if (!link) continue

    const name = stripTags(link[3])
    if (!name) continue

    const size = CELL_RE.exec(block)?.[1] ?? ''
    const seeders = SEED_RE.exec(block)?.[1] ?? ''
    const leechers = LEECH_RE.exec(block)?.[1] ?? ''
    const dateText = stripTags(DATE_RE.exec(block)?.[1] ?? '')

    rows.push({
      url: `https://1337x.to${link[1]}`,
      name,
      size: stripTags(size),
      seeders: stripTags(seeders),
      leechers: stripTags(leechers),
      addedAt: parseRssDate(dateText)
    })
  }
  return rows
}

export const one337xProvider: TorrentProvider = {
  id: '1337x',
  name: '1337x',
  description: '1337x.to search results — scraped from the public result listing.',
  supportsCategories: false,
  themes: ['movies', 'tv', 'anime', 'music', 'games', 'books', 'apps', 'other'],

  async search(ctx: ProviderSearchContext) {
    const slug = encodeURIComponent(ctx.query.trim().replace(/\s+/g, '-'))
    const rows: Row[] = []

    // Page 1 is mandatory; page 2 is best-effort so a flaky second request
    // doesn't cost us the results we already have.
    for (let page = 1; page <= MAX_PAGES; page++) {
      let body: { status: number; body: string }
      try {
        body = await httpText(`https://1337x.to/search/${slug}/${page}/`, {
          proxy: ctx.proxy,
          timeout: 20000
        })
      } catch (error) {
        if (page === 1) throw error
        console.warn('[1337x] page', page, 'failed:', (error as Error).message)
        break
      }
      if (body.status !== 200) {
        if (page === 1) throw new Error(`HTTP ${body.status}`)
        console.warn('[1337x] page', page, 'returned HTTP', body.status)
        break
      }
      if (page > 1) {
        try {
          assertNotChallenge(body.body)
        } catch (error) {
          // Page 2 is best-effort: keep the page-1 results we already have.
          console.warn('[1337x] page', page, 'challenged:', (error as Error).message)
          break
        }
      } else {
        assertNotChallenge(body.body)
      }
      const parsed = parseRows(body.body)
      if (parsed.length === 0) break
      rows.push(...parsed)
    }

    return rows.map((row) =>
      toResult({
        provider: one337xProvider,
        id: row.url,
        name: row.name,
        size: parseSizeToBytes(row.size),
        seeders: Number(row.seeders) || 0,
        leechers: Number(row.leechers) || 0,
        addedAt: row.addedAt,
        url: row.url,
        trackers: ctx.trackers
      })
    )
  },

  async health(ctx) {
    const started = Date.now()
    try {
      const body = await httpText('https://1337x.to/home', { proxy: ctx.proxy, timeout: 12000 })
      const latencyMs = Date.now() - started
      if (body.status !== 200) {
        return { ...emptyHealth(one337xProvider), latencyMs, error: `HTTP ${body.status}` }
      }
      assertNotChallenge(body.body)
      return {
        reachable: true,
        latencyMs,
        supportsCategories: false,
        lastChecked: Date.now()
      }
    } catch (error) {
      return {
        ...emptyHealth(one337xProvider),
        latencyMs: Date.now() - started,
        error: (error as Error).message
      }
    }
  }
}
