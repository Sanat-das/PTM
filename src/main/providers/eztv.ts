import { httpJson } from '../net/http.ts'
import { emptyHealth, toResult, type ProviderSearchContext, type TorrentProvider } from './types.ts'

interface EztvTorrent {
  id: number
  hash?: string
  filename: string
  episode_url: string
  torrent_url: string
  magnet_url: string
  title: string
  imdb_id: string
  season: string
  episode: string
  seeds: string
  peers: string
  size_bytes: string
  size: string
}

interface EztvResponse {
  torrents?: EztvTorrent[]
}

/** EZTV indexes by IMDb id, so it is queried in a second pass with ids from the main results. */
export const eztvProvider: TorrentProvider = {
  id: 'eztv',
  name: 'EZTV',
  description: 'eztv.re API — episode torrents, looked up by IMDb id after the main search.',
  supportsCategories: false,
  themes: ['tv'],

  async search(ctx: ProviderSearchContext) {
    const imdbId = ctx.imdbId ?? (/^tt\d+$/i.test(ctx.query) ? ctx.query : undefined)
    if (!imdbId) return []

    const url = new URL('https://eztv.re/api/get-torrents')
    url.searchParams.set('imdb_id', imdbId)
    url.searchParams.set('limit', '50')

    const payload = await httpJson<EztvResponse>(url.toString(), {
      proxy: ctx.proxy,
      timeout: 15000
    })
    const torrents = payload.torrents ?? []

    return torrents.map((torrent) =>
      toResult({
        provider: eztvProvider,
        id: String(torrent.id),
        name: torrent.title ?? torrent.filename,
        infoHash: torrent.hash?.toLowerCase(),
        magnet: torrent.magnet_url,
        size: Number(torrent.size_bytes) || 0,
        seeders: Number(torrent.seeds) || 0,
        leechers: Number(torrent.peers) || 0,
        category: '205',
        imdbId: torrent.imdb_id,
        url: torrent.torrent_url,
        trackers: ctx.trackers
      })
    )
  },

  async health(ctx) {
    const started = Date.now()
    try {
      await httpJson('https://eztv.re/api/get-torrents?limit=1', {
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
        ...emptyHealth(eztvProvider),
        latencyMs: Date.now() - started,
        error: (error as Error).message
      }
    }
  }
}
