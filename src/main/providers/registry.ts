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
  const active = providers.filter(isProviderEnabled)
  const theme = filters.themes.length === 1 ? filters.themes[0] : undefined

  const settled = await Promise.allSettled(
    active.map(async (provider) => {
      const ctx: ProviderSearchContext = {
        query,
        proxy: options.proxy,
        trackers: options.trackers,
        theme,
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

  // EZTV only works with an IMDb id, so it runs as a second pass using ids
  // discovered by the primary providers.
  const imdbIds = [...new Set(collected.map((r) => r.imdbId).filter((id): id is string => !!id))]
  if (imdbIds.length && isProviderEnabled(eztvProvider)) {
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
    for (const entry of eztvResults) {
      if (entry.status === 'fulfilled') {
        collected.push(...entry.value)
        count += entry.value.length
      }
    }
    const existing = health.find((h) => h.id === eztvProvider.id)
    if (existing) {
      existing.reachable = true
      existing.resultCount = count
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
