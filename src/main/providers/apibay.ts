import type { Theme } from '../../shared/types.ts'
import { httpJson, httpText } from '../net/http.ts'
import { emptyHealth, toResult, type ProviderSearchContext, type TorrentProvider } from './types.ts'

interface ApibayRow {
  id: string
  name: string
  info_hash: string
  leechers: string
  seeders: string
  size: string
  num_files: string
  username: string
  added: string
  status: string
  category: string
  imdb: string
}

/** The Pirate Bay's public JSON API (apibay.org). */
export const apibayProvider: TorrentProvider = {
  id: 'apibay',
  name: 'The Pirate Bay',
  description: 'apibay.org JSON API — broad catalogue across video, audio, games and books.',
  supportsCategories: true,
  themes: ['movies', 'tv', 'anime', 'music', 'games', 'books', 'apps', 'adult', 'other'],

  async search(ctx: ProviderSearchContext) {
    const category = themeToCategory(ctx.theme)
    const url = new URL('https://apibay.org/q.php')
    url.searchParams.set('q', ctx.query)
    if (category) url.searchParams.set('cat', category)

    const rows = await httpJson<ApibayRow[]>(url.toString(), { proxy: ctx.proxy, timeout: 20000 })
    if (!Array.isArray(rows)) return []

    const results = []
    for (const row of rows) {
      if (!row || row.info_hash === '0000000000000000000000000000000000000000') continue
      results.push(
        toResult({
          provider: apibayProvider,
          id: row.id,
          name: row.name,
          infoHash: row.info_hash,
          size: Number(row.size) || 0,
          seeders: Number(row.seeders) || 0,
          leechers: Number(row.leechers) || 0,
          category: row.category,
          imdbId: row.imdb,
          addedAt: Number(row.added) || undefined,
          fileCount: Number(row.num_files) || undefined,
          uploader: row.username,
          status: row.status,
          trackers: ctx.trackers
        })
      )
    }
    return results
  },

  async health(ctx) {
    const started = Date.now()
    try {
      const body = await httpText('https://apibay.org/q.php?q=ptm&cat=200', {
        proxy: ctx.proxy,
        timeout: 12000
      })
      const latencyMs = Date.now() - started
      if (body.status !== 200) {
        return { ...emptyHealth(apibayProvider), latencyMs, error: `HTTP ${body.status}` }
      }
      return { reachable: true, latencyMs, supportsCategories: true, lastChecked: Date.now() }
    } catch (error) {
      return {
        ...emptyHealth(apibayProvider),
        latencyMs: Date.now() - started,
        error: (error as Error).message
      }
    }
  }
}

/** apibay only accepts top-level category ids. */
function themeToCategory(theme?: Theme): string | null {
  if (!theme) return null
  switch (theme) {
    case 'movies':
    case 'tv':
    case 'anime':
      return '200'
    case 'music':
      return '100'
    case 'apps':
      return '300'
    case 'games':
      return '400'
    case 'adult':
      return '500'
    case 'books':
    case 'other':
      return '600'
    default:
      return null
  }
}

