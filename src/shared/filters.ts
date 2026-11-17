import type { SearchFilters, TorrentResult } from './types.ts'

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function timeAgo(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function applyFilters(results: TorrentResult[], filters: SearchFilters): TorrentResult[] {
  const maxSize = filters.maxSizeGb > 0 ? filters.maxSizeGb * 1024 ** 3 : Infinity
  const hasAgeLimit = filters.maxAgeDays > 0
  const maxAge = hasAgeLimit ? Date.now() / 1000 - filters.maxAgeDays * 86400 : Infinity

  const filtered = results.filter((r) => {
    if (filters.themes.length && !filters.themes.includes(r.theme)) return false
    if (filters.resolutions.length && !filters.resolutions.includes(r.release.resolution)) return false
    if (filters.sources.length && !filters.sources.includes(r.release.source)) return false
    if (filters.codecs.length && !filters.codecs.includes(r.release.codec)) return false
    if (r.seeders < filters.minSeeders) return false
    if (r.size > maxSize) return false
    if (hasAgeLimit && r.addedAt && r.addedAt < maxAge) return false
    if (filters.hideDead && r.seeders <= 0) return false
    return true
  })

  const sorted = [...filtered]
  switch (filters.sort) {
    case 'seeders':
      sorted.sort((a, b) => b.seeders - a.seeders)
      break
    case 'leechers':
      sorted.sort((a, b) => a.leechers - b.leechers)
      break
    case 'size':
      sorted.sort((a, b) => b.size - a.size)
      break
    case 'date':
      sorted.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      break
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
  }
  return sorted
}

/** Distinct values present in a result set, for building the filter chips. */
export function facetCounts(results: TorrentResult[]) {
  const themes = new Map<string, number>()
  const resolutions = new Map<string, number>()
  const sources = new Map<string, number>()
  const codecs = new Map<string, number>()

  for (const r of results) {
    themes.set(r.theme, (themes.get(r.theme) ?? 0) + 1)
    resolutions.set(r.release.resolution, (resolutions.get(r.release.resolution) ?? 0) + 1)
    sources.set(r.release.source, (sources.get(r.release.source) ?? 0) + 1)
    codecs.set(r.release.codec, (codecs.get(r.release.codec) ?? 0) + 1)
  }

  const toEntries = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))

  return {
    themes: toEntries(themes),
    resolutions: toEntries(resolutions),
    sources: toEntries(sources),
    codecs: toEntries(codecs)
  }
}
