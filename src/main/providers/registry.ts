import type { ProviderHealth, SearchFilters, TorrentResult } from '../../shared/types.ts'
import { settings } from '../settings.ts'
import { apibayProvider } from './apibay.ts'
import { eztvProvider } from './eztv.ts'
import { nyaaProvider } from './nyaa.ts'
import { one337xProvider } from './one337x.ts'
import { ytsProvider } from './yts.ts'
import type { ProviderSearchContext, TorrentProvider } from './types.ts'
import { dedupe } from './dedupe.ts'

export const providers: TorrentProvider[] = [
  apibayProvider,
  nyaaProvider,
  ytsProvider,
  one337xProvider,
  eztvProvider
]

export function isProviderEnabled(provider: TorrentProvider): boolean {
  const configured = settings.get().providers
  return configured[provider.id] !== false
}

export interface AggregatedSearch {
  results: TorrentResult[]
  health: ProviderHealth[]
  elapsedMs: number
}

export async function searchAll(
  query: string,
  filters: SearchFilters,
  options: { trackers: string[]; proxy: ProviderSearchContext['proxy'] }
): Promise<AggregatedSearch> {
  const started = Date.now()
  // EZTV only works with an IMDb id, so it is held out of the fan-out and
  // queried in a second pass against TV results that carry one.
  // 1337x's URL is a search-path lookup, so it cannot answer a query-free
  // Browse request. The other providers have a native browse/list endpoint.
  const active = providers
    .filter(isProviderEnabled)
    .filter((provider) => provider !== eztvProvider)
    .filter((provider) => query.trim().length > 0 || provider.id !== '1337x')
  const theme = filters.themes.length === 1 ? filters.themes[0] : undefined

  const settled = await Promise.allSettled(
    active.map(async (provider) => {
      const ctx: ProviderSearchContext = {
        query,
        proxy: options.proxy,
        trackers: options.trackers,
        theme,
        category: filters.category
      }
      const results = await provider.search(ctx)
      return { provider, results }
    })
  )

  const health: ProviderHealth[] = []
  const collected: TorrentResult[] = []

  settled.forEach((entry, index) => {
    const provider = active[index]
    if (entry.status === 'fulfilled') {
      health.push({
        id: provider.id,
        name: provider.name,
        enabled: true,
        reachable: true,
        resultCount: entry.value.results.length,
        supportsCategories: provider.supportsCategories,
        lastChecked: Date.now()
      })
      collected.push(...entry.value.results)
    } else {
      const error = entry.reason as Error
      health.push({
        id: provider.id,
        name: provider.name,
        enabled: true,
        reachable: false,
        error: error?.message ?? String(entry.reason),
        supportsCategories: provider.supportsCategories,
        lastChecked: Date.now()
      })
    }
  })

  // EZTV second pass: query by the IMDb ids found in TV-flavoured primary
  // results (movies are not in EZTV, and YTS is movie-only).
  if (isProviderEnabled(eztvProvider)) {
    const imdbIds = [
      ...new Set(
        collected
          .filter((r) => r.imdbId && (r.release.season !== undefined || r.theme === 'tv'))
          .map((r) => r.imdbId as string)
      )
    ]
    if (imdbIds.length) {
      const eztvResults = await Promise.allSettled(
        imdbIds.slice(0, 10).map(async (imdbId) =>
          eztvProvider.search({
            query,
            imdbId,
            proxy: options.proxy,
            trackers: options.trackers
          })
        )
      )
      let count = 0
      let succeeded = 0
      let lastError: string | undefined
      for (const entry of eztvResults) {
        if (entry.status === 'fulfilled') {
          collected.push(...entry.value)
          count += entry.value.length
          succeeded += 1
        } else {
          lastError = (entry.reason as Error)?.message ?? String(entry.reason)
        }
      }
      health.push({
        id: eztvProvider.id,
        name: eztvProvider.name,
        enabled: true,
        reachable: succeeded > 0,
        error: succeeded > 0 ? undefined : (lastError ?? 'All lookups failed'),
        resultCount: count,
        supportsCategories: eztvProvider.supportsCategories,
        lastChecked: Date.now()
      })
    } else {
      // Nothing to query by; report an honest reachability probe instead of a
      // fabricated "healthy" row.
      const probe = await eztvProvider.health({ proxy: options.proxy })
      health.push({
        id: eztvProvider.id,
        name: eztvProvider.name,
        enabled: true,
        ...probe
      } as ProviderHealth)
    }
  }

  // Fill in health rows for providers that were not part of this search.
  for (const provider of providers) {
    if (!health.some((h) => h.id === provider.id)) {
      health.push({
        id: provider.id,
        name: provider.name,
        enabled: isProviderEnabled(provider),
        reachable: false,
        supportsCategories: provider.supportsCategories,
        lastChecked: Date.now()
      })
    }
  }

  return {
    results: dedupe(collected),
    health,
    elapsedMs: Date.now() - started
  }
}

export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  const proxy = settings.get().proxy
  return Promise.all(
    providers.map(async (provider) => {
      const enabled = isProviderEnabled(provider)
      if (!enabled) {
        return {
          id: provider.id,
          name: provider.name,
          enabled: false,
          reachable: false,
          supportsCategories: provider.supportsCategories,
          lastChecked: Date.now()
        } as ProviderHealth
      }
      const result = await provider.health({ proxy })
      return {
        id: provider.id,
        name: provider.name,
        enabled: true,
        ...result
      } as ProviderHealth
    })
  )
}
