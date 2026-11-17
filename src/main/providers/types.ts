import type { ProviderHealth, ProxyConfig, Theme, TorrentResult } from '../../shared/types.ts'
import { parseRelease, themeFromCategory, themeFromName } from '../../shared/release.ts'

export interface ProviderSearchContext {
  query: string
  proxy?: ProxyConfig
  trackers: string[]
  /** Narrow the search to a single theme, when the provider supports it. */
  theme?: Theme
  /** IMDB id, used by providers that index by imdb id (EZTV). */
  imdbId?: string
}

export interface TorrentProvider {
  id: string
  name: string
  description: string
  supportsCategories: boolean
  themes: Theme[]
  search(ctx: ProviderSearchContext): Promise<TorrentResult[]>
  health(ctx: { proxy?: ProxyConfig }): Promise<Omit<ProviderHealth, 'id' | 'name' | 'enabled'>>
}

export function buildMagnet(infoHash: string, name?: string, trackers: string[] = []): string {
  const parts = [`magnet:?xt=urn:btih:${infoHash}`]
  if (name) parts.push(`dn=${encodeURIComponent(name)}`)
  for (const tracker of trackers) parts.push(`tr=${encodeURIComponent(tracker)}`)
  return parts.join('&')
}

export function emptyHealth(provider: TorrentProvider): Omit<
  ProviderHealth,
  'id' | 'name' | 'enabled'
> {
  return {
    reachable: false,
    supportsCategories: provider.supportsCategories,
    lastChecked: Date.now()
  }
}

/**
 * Normalise a raw provider row into the app's TorrentResult shape.
 * Release-name parsing is what powers the theme/quality filters, so it always runs.
 */
export function toResult(params: {
  provider: TorrentProvider
  id: string
  name: string
  infoHash?: string
  magnet?: string
  size: number
  seeders: number
  leechers: number
  category?: string
  imdbId?: string
  addedAt?: number
  url?: string
  fileCount?: number
  uploader?: string
  status?: string
  theme?: Theme
  trackers: string[]
}): TorrentResult {
  const release = parseRelease(params.name)
  const categoryTheme = params.category ? themeFromCategory(params.category) : undefined
  const nameTheme = themeFromName(params.name, release)
  // A specific theme read from the release name beats the index category,
  // which is very often the catch-all "Other".
  const theme = params.theme ?? (nameTheme !== 'movies' ? nameTheme : (categoryTheme ?? nameTheme))

  return {
    id: `${params.provider.id}:${params.id}`,
    provider: params.provider.id,
    providerLabel: params.provider.name,
    name: params.name,
    magnet:
      params.magnet ??
      (params.infoHash ? buildMagnet(params.infoHash, params.name, params.trackers) : undefined),
    infoHash: params.infoHash,
    size: params.size,
    seeders: params.seeders,
    leechers: params.leechers,
    category: params.category ?? '',
    theme,
    imdbId: params.imdbId && params.imdbId !== '0' ? params.imdbId : undefined,
    addedAt: params.addedAt,
    url: params.url,
    fileCount: params.fileCount,
    uploader: params.uploader,
    status: params.status,
    release
  }
}
