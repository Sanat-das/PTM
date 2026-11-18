import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { facetCounts } from '../../../shared/filters.ts'
import type { Codec, Resolution, Source, TorrentResult } from '../../../shared/types.ts'
import { SORT_OPTIONS, useUiStore } from '../lib/store.ts'

interface FilterPanelProps {
  results: TorrentResult[]
}

const THEME_LABELS: Record<string, string> = {
  movies: 'Movies',
  tv: 'TV',
  anime: 'Anime',
  music: 'Music',
  games: 'Games',
  books: 'Books',
  apps: 'Apps',
  adult: 'Adult',
  other: 'Other'
}

export function FilterPanel({ results }: FilterPanelProps) {
  const filters = useUiStore((state) => state.filters)
  const setFilters = useUiStore((state) => state.setFilters)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleResolution = useUiStore((state) => state.toggleResolution)
  const toggleSource = useUiStore((state) => state.toggleSource)
  const toggleCodec = useUiStore((state) => state.toggleCodec)
  const resetFilters = useUiStore((state) => state.resetFilters)

  const facets = useMemo(() => facetCounts(results), [results])

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-850">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-mist-400">Filters</h2>
        <button
          onClick={resetFilters}
          title="Reset filters"
          aria-label="Reset filters"
          className="rounded p-1 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-100"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <FilterGroup label="Theme">
          {facets.themes.map(({ value, count }) => {
            const active = filters.themes.includes(value as never)
            return (
              <Chip
                key={value}
                active={active}
                count={count}
                onClick={() => toggleTheme(value as never)}
              >
                {THEME_LABELS[value] ?? value}
              </Chip>
            )
          })}
          {facets.themes.length === 0 && <Empty label="No themes in results" />}
        </FilterGroup>

        <FilterGroup label="Resolution">
          {facets.resolutions
            .filter((entry) => entry.value !== 'unknown')
            .map(({ value, count }) => (
              <Chip
                key={value}
                active={filters.resolutions.includes(value as Resolution)}
                count={count}
                onClick={() => toggleResolution(value as Resolution)}
              >
                {value}
              </Chip>
            ))}
          {facets.resolutions.filter((e) => e.value !== 'unknown').length === 0 && (
            <Empty label="No resolutions in results" />
          )}
        </FilterGroup>

        <FilterGroup label="Source">
          {facets.sources
            .filter((entry) => entry.value !== 'unknown')
            .map(({ value, count }) => (
              <Chip
                key={value}
                active={filters.sources.includes(value as Source)}
                count={count}
                onClick={() => toggleSource(value as Source)}
              >
                {value}
              </Chip>
            ))}
          {facets.sources.filter((e) => e.value !== 'unknown').length === 0 && (
            <Empty label="No sources in results" />
          )}
        </FilterGroup>

        <FilterGroup label="Codec">
          {facets.codecs
            .filter((entry) => entry.value !== 'unknown')
            .map(({ value, count }) => (
              <Chip
                key={value}
                active={filters.codecs.includes(value as Codec)}
                count={count}
                onClick={() => toggleCodec(value as Codec)}
              >
                {value}
              </Chip>
            ))}
          {facets.codecs.filter((e) => e.value !== 'unknown').length === 0 && (
            <Empty label="No codecs in results" />
          )}
        </FilterGroup>

        <div>
          <label
            htmlFor="filter-min-seeders"
            className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-mist-400"
          >
            Minimum seeders: {filters.minSeeders}
          </label>
          <input
            id="filter-min-seeders"
            type="range"
            min={0}
            max={200}
            step={5}
            value={filters.minSeeders}
            onChange={(event) => setFilters({ minSeeders: Number(event.target.value) })}
            className="w-full accent-[var(--color-accent-500)]"
          />
        </div>

        <div>
          <label
            htmlFor="filter-max-size"
            className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-mist-400"
          >
            Maximum size
          </label>
          <select
            id="filter-max-size"
            value={filters.maxSizeGb}
            onChange={(event) => setFilters({ maxSizeGb: Number(event.target.value) })}
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-mist-100 focus:border-accent-500 focus:outline-none"
          >
            <option value={0}>Any size</option>
            <option value={1}>Up to 1 GB</option>
            <option value={4}>Up to 4 GB</option>
            <option value={8}>Up to 8 GB</option>
            <option value={20}>Up to 20 GB</option>
            <option value={50}>Up to 50 GB</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-max-age"
            className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-mist-400"
          >
            Maximum age
          </label>
          <select
            id="filter-max-age"
            value={filters.maxAgeDays}
            onChange={(event) => setFilters({ maxAgeDays: Number(event.target.value) })}
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-mist-100 focus:border-accent-500 focus:outline-none"
          >
            <option value={0}>Any age</option>
            <option value={1}>Up to 1 day</option>
            <option value={7}>Up to 1 week</option>
            <option value={30}>Up to 1 month</option>
            <option value={90}>Up to 3 months</option>
            <option value={365}>Up to 1 year</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-sort"
            className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-mist-400"
          >
            Sort by
          </label>
          <select
            id="filter-sort"
            value={filters.sort}
            onChange={(event) => setFilters({ sort: event.target.value as never })}
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-mist-100 focus:border-accent-500 focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-mist-200">
          <input
            type="checkbox"
            checked={filters.hideDead}
            onChange={(event) => setFilters({ hideDead: event.target.checked })}
            className="accent-[var(--color-accent-500)]"
          />
          Hide dead torrents
        </label>
      </div>
    </aside>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-mist-400">{label}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  active,
  count,
  onClick,
  children
}: {
  active: boolean
  count: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
        active
          ? 'border-accent-500 bg-accent-600/20 text-accent-400'
          : 'border-ink-600 bg-ink-800 text-mist-200 hover:border-ink-500'
      }`}
    >
      {children}
      <span className="text-[10px] text-mist-400">{count}</span>
    </button>
  )
}

function Empty({ label }: { label: string }) {
  return <span className="text-[11px] text-mist-400">{label}</span>
}
