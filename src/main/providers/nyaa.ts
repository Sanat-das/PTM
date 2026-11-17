import { XMLParser } from 'fast-xml-parser'
import type { Theme } from '../../shared/types.ts'
import { httpText } from '../net/http.ts'
import { emptyHealth, toResult, type ProviderSearchContext, type TorrentProvider } from './types.ts'
import { parseRssDate, parseSizeToBytes } from './util.ts'

interface NyaaItem {
  title?: string
  link?: string
  guid?: string | { '#text'?: string }
  pubDate?: string
  'nyaa:seeders'?: number
  'nyaa:leechers'?: number
  'nyaa:infoHash'?: string
  'nyaa:size'?: string
  'nyaa:categoryId'?: string
  'nyaa:category'?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: false,
  parseTagValue: false
})

const CATEGORY_THEME: Record<string, Theme> = {
  '1_0': 'anime',
  '1_1': 'anime',
  '1_2': 'anime',
  '1_3': 'anime',
  '1_4': 'anime',
  '2_0': 'music',
  '2_1': 'music',
  '2_2': 'music',
  '3_0': 'books',
  '3_1': 'books',
  '4_0': 'tv',
  '4_1': 'tv',
  '4_2': 'tv',
  '6_0': 'apps',
  '6_1': 'apps',
  '6_2': 'apps'
}

export const nyaaProvider: TorrentProvider = {
  id: 'nyaa',
  name: 'Nyaa',
  description: 'nyaa.si RSS feed — the reference source for anime releases.',
  supportsCategories: true,
  themes: ['anime'],

  async search(ctx: ProviderSearchContext) {
    const url = new URL('https://nyaa.si/')
    url.searchParams.set('page', 'rss')
    url.searchParams.set('q', ctx.query)
    url.searchParams.set('c', '0_0')

    const body = await httpText(url.toString(), { proxy: ctx.proxy, timeout: 20000 })
    if (body.status !== 200) throw new Error(`HTTP ${body.status}`)

    const doc = parser.parse(body.body) as {
      rss?: { channel?: { item?: NyaaItem[] } }
    }
    const items = doc?.rss?.channel?.item
    if (!items) return []
    const list = Array.isArray(items) ? items : [items]

    const results = []
    for (const item of list) {
      const name = item.title?.trim()
      if (!name) continue
      const infoHash = item['nyaa:infoHash']?.trim()
      const categoryId = item['nyaa:categoryId'] ?? ''
      // Unknown categories default to 'other'; the name parser still gets its
      // say via toResult's theme precedence.
      const theme = CATEGORY_THEME[categoryId] ?? 'other'
      const guid = typeof item.guid === 'object' ? item.guid['#text'] : item.guid

      results.push(
        toResult({
          provider: nyaaProvider,
          id: infoHash ?? name,
          name,
          infoHash: infoHash?.toLowerCase(),
          // item.link is the .torrent download, not a magnet: let toResult build
          // a magnet from the info hash so the engine can use trackers and DHT.
          url: item.link ?? guid,
          size: parseSizeToBytes(item['nyaa:size']),
          seeders: Number(item['nyaa:seeders']) || 0,
          leechers: Number(item['nyaa:leechers']) || 0,
          category: categoryId,
          addedAt: parseRssDate(item.pubDate),
          theme,
          trackers: ctx.trackers
        })
      )
    }
    return results
  },

  async health(ctx) {
    const started = Date.now()
    try {
      const body = await httpText('https://nyaa.si/?page=rss&q=ptm', {
        proxy: ctx.proxy,
        timeout: 12000
      })
      const latencyMs = Date.now() - started
      if (body.status !== 200) {
        return { ...emptyHealth(nyaaProvider), latencyMs, error: `HTTP ${body.status}` }
      }
      return { reachable: true, latencyMs, supportsCategories: true, lastChecked: Date.now() }
    } catch (error) {
      return {
        ...emptyHealth(nyaaProvider),
        latencyMs: Date.now() - started,
        error: (error as Error).message
      }
    }
  }
}
