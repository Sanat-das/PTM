import type { Theme } from '../../shared/types.ts'
import { httpJson } from '../net/http.ts'
import { emptyHealth, toResult, type ProviderSearchContext, type TorrentProvider } from './types.ts'
import { parseSizeToBytes } from './util.ts'

interface YtsTorrent {
  url: string
  hash: string
  quality: string
  seeds: number
  peers: number
  size: string
  type: string
  video_codec: string
}

interface YtsMovie {
  id: number
  title: string
  title_long: string
  year: number
  imdb_code: string
  genres: string[]
  torrents: YtsTorrent[]
}

interface YtsResponse {
  status: string
  data?: { movies?: YtsMovie[] }
}

/** yts.mx rotates mirrors; try each until one answers. */
const MIRRORS = ['https://yts.mx', 'https://yts.lt', 'https://yts.rs']

export const ytsProvider: TorrentProvider = {
  id: 'yts',
  name: 'YTS',
  description: 'yts.mx movie API — small, clean 720p/1080p releases with IMDb metadata.',
  supportsCategories: false,
  themes: ['movies'],

  async search(ctx: ProviderSearchContext) {
    let payload: YtsResponse | null = null
    let lastError: Error | null = null

    for (const mirror of MIRRORS) {
      const url = new URL(`${mirror}/api/v2/list_movies.json`)
      url.searchParams.set('query', ctx.query)
      url.searchParams.set('limit', '50')
      try {
        payload = await httpJson<YtsResponse>(url.toString(), { proxy: ctx.proxy, timeout: 15000 })
        break
      } catch (error) {
        lastError = error as Error
      }
    }

    if (!payload) throw lastError ?? new Error('No YTS mirror responded')
    if (payload.status !== 'ok' || !payload.data?.movies) return []

    const results = []
    for (const movie of payload.data.movies) {
      for (const torrent of movie.torrents ?? []) {
        const name = `${movie.title_long} [${torrent.type}] [${torrent.quality}] [${torrent.video_codec}]`
        results.push(
          toResult({
            provider: ytsProvider,
            id: `${movie.id}-${torrent.hash}`,
            name,
            infoHash: torrent.hash?.toLowerCase(),
            size: parseSizeToBytes(torrent.size),
            seeders: torrent.seeds ?? 0,
            leechers: torrent.peers ?? 0,
            category: '201',
            imdbId: movie.imdb_code,
            addedAt: undefined,
            url: torrent.url,
            trackers: ctx.trackers
          })
        )
      }
    }
    return results
  },

  async health(ctx) {
    const started = Date.now()
    try {
      await httpJson(`${MIRRORS[0]}/api/v2/list_movies.json?query=ptm&limit=1`, {
        proxy: ctx.proxy,
        timeout: 12000
      })
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        supportsCategories: false,
        lastChecked: Date.now()
      }
    } catch (error) {
      return {
        ...emptyHealth(ytsProvider),
        latencyMs: Date.now() - started,
        error: (error as Error).message
      }
    }
  }
}

export const _theme: Theme = 'movies'
