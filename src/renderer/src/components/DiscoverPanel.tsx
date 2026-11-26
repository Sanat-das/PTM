import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, Clapperboard, Dices, Film, Search, Settings2, Star, Tv } from 'lucide-react'
import { DISCOVER_SORT_LABELS, genresFor } from '../../../shared/discover.ts'
import type { DiscoverItem, DiscoverSort } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

const SORTS: DiscoverSort[] = ['popular', 'rating', 'newest']
const thisYear = new Date().getFullYear()
const YEARS = Array.from({ length: 26 }, (_, index) => thisYear - index)

/** TMDB-powered recommendations driven by the user's genre/year/rating choices. */
export function DiscoverPanel() {
  const settings = useUiStore((state) => state.discover)
  const setDiscover = useUiStore((state) => state.setDiscover)
  const searchFor = useUiStore((state) => state.searchFor)
  const setPanel = useUiStore((state) => state.setPanel)

  const genres = useMemo(() => genresFor(settings.kind), [settings.kind])

  // Each TMDB page holds 20 titles; keep appending pages instead of capping
  // the grid at a single page.
  const discoverQuery = useInfiniteQuery({
    queryKey: ['discover', settings],
    queryFn: ({ pageParam }) => api.discover({ ...settings, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.items.length === 20 && lastPageParam < 50 ? lastPageParam + 1 : undefined,
    staleTime: 5 * 60_000
  })

  const surprise = () => {
    const pool = genres.length ? genres : genresFor('movie')
    setDiscover({
      genreId: pool[Math.floor(Math.random() * pool.length)].id,
      year: Math.random() < 0.5 ? null : YEARS[Math.floor(Math.random() * 10)],
      sort: SORTS[Math.floor(Math.random() * SORTS.length)]
    })
  }

  const items = discoverQuery.data?.pages.flatMap((page) => page.items) ?? []
  const configured = discoverQuery.data?.pages[0]?.configured

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="shrink-0 space-y-3 border-b border-ink-700 bg-ink-850/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-ink-600">
            {(['movie', 'tv'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={settings.kind === kind}
                onClick={() => setDiscover({ kind, genreId: null })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  settings.kind === kind
                    ? 'bg-accent-600/20 text-accent-400'
                    : 'text-mist-400 hover:text-mist-100'
                }`}
              >
                {kind === 'tv' ? <Tv size={13} /> : <Clapperboard size={13} />}
                {kind === 'tv' ? 'TV' : 'Movies'}
              </button>
            ))}
          </div>

          <Select
            label="Year"
            value={settings.year ?? 0}
            onChange={(value) => setDiscover({ year: Number(value) === 0 ? null : Number(value) })}
            options={[{ value: 0, label: 'Any year' }, ...YEARS.map((year) => ({ value: year, label: String(year) }))]}
          />
          <Select
            label="Minimum rating"
            value={settings.minRating ?? 0}
            onChange={(value) =>
              setDiscover({ minRating: Number(value) === 0 ? null : Number(value) })
            }
            options={[
              { value: 0, label: 'Any rating' },
              { value: 6, label: '6.0+' },
              { value: 7, label: '7.0+' },
              { value: 8, label: '8.0+' },
              { value: 9, label: '9.0+' }
            ]}
          />
          <Select
            label="Sort"
            value={settings.sort}
            onChange={(value) => setDiscover({ sort: value as DiscoverSort })}
            options={SORTS.map((sort) => ({ value: sort, label: DISCOVER_SORT_LABELS[sort] }))}
          />
          <button
            type="button"
            onClick={surprise}
            className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-mist-200 transition-colors hover:border-accent-500 hover:text-accent-400"
          >
            <Dices size={13} /> Surprise me
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={settings.genreId === null}
            onClick={() => setDiscover({ genreId: null })}
            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
              settings.genreId === null
                ? 'border-accent-500 bg-accent-600/20 text-accent-400'
                : 'border-ink-600 bg-ink-800 text-mist-200 hover:border-ink-500'
            }`}
          >
            All genres
          </button>
          {genres.map((genre) => {
            const active = settings.genreId === genre.id
            return (
              <button
                key={genre.id}
                type="button"
                aria-pressed={active}
                onClick={() => setDiscover({ genreId: active ? null : genre.id })}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-accent-500 bg-accent-600/20 text-accent-400'
                    : 'border-ink-600 bg-ink-800 text-mist-200 hover:border-ink-500'
                }`}
              >
                {genre.name}
              </button>
            )
          })}
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {configured === false ? (
          <div className="m-4 flex items-center gap-4 rounded-lg border border-warn-500/40 bg-warn-500/10 p-4">
            <Settings2 size={18} className="shrink-0 text-warn-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-mist-100">Discover needs a TMDB API key</p>
              <p className="mt-0.5 text-xs text-mist-400">
                Add a free key in Settings → Metadata to browse recommendations by genre, year and rating.
                Search and Browse work without it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanel('settings')}
              className="shrink-0 rounded-md border border-warn-500/50 px-3 py-1.5 text-xs text-warn-500 hover:bg-warn-500/15"
            >
              Open Settings
            </button>
          </div>
        ) : discoverQuery.isPending ? (
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="h-80 animate-pulse rounded-lg bg-ink-800" />
            ))}
          </div>
        ) : discoverQuery.isError ? (
          <div className="p-8 text-center text-sm text-bad-500">
            Could not load recommendations. Check your connection or TMDB key.
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-mist-400">
            No titles matched those choices. Try widening the year or lowering the rating.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {items.map((item) => (
                <DiscoverCard
                  key={`${item.kind}-${item.tmdbId}`}
                  item={item}
                  onSearch={() =>
                    searchFor(
                      `${item.title}${item.year ? ` ${item.year}` : ''}`,
                      item.kind === 'tv' ? 'tv' : 'movies'
                    )
                  }
                />
              ))}
            </div>
            <div className="flex flex-col items-center gap-2 pb-6">
              <span className="text-[11px] text-mist-400">{items.length} titles loaded</span>
              {discoverQuery.hasNextPage && (
                <button
                  type="button"
                  disabled={discoverQuery.isFetchingNextPage}
                  onClick={() => void discoverQuery.fetchNextPage()}
                  className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-4 py-2 text-xs text-mist-200 transition-colors hover:border-accent-500 hover:text-accent-400 disabled:opacity-50"
                >
                  <ChevronDown size={13} />
                  {discoverQuery.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string | number
  onChange: (value: string | number) => void
  options: Array<{ value: string | number; label: string }>
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-mist-400">
      <span className="uppercase tracking-wider">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) =>
          onChange(typeof value === 'number' ? Number(event.target.value) : event.target.value)
        }
        className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-mist-100 focus:border-accent-500 focus:outline-none"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function DiscoverCard({ item, onSearch }: { item: DiscoverItem; onSearch: () => void }) {
  const genres = useMemo(() => genresFor(item.kind), [item.kind])
  const genreNames = item.genreIds
    .map((id) => genres.find((genre) => genre.id === id)?.name)
    .filter(Boolean)
    .slice(0, 2)

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-850 transition-colors hover:border-ink-500">
      <div className="relative aspect-[2/3] overflow-hidden bg-ink-800">
        {item.poster ? (
          <img
            src={item.poster}
            alt={`${item.title} poster`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-mist-400">
            <Film size={28} />
          </div>
        )}
        {item.rating ? (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-ink-950/80 px-1.5 py-0.5 text-[11px] font-medium text-warn-500 backdrop-blur">
            <Star size={10} fill="currentColor" /> {item.rating.toFixed(1)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-2 text-xs font-medium text-mist-100" title={item.title}>
          {item.title}
        </h3>
        <p className="text-[11px] text-mist-400">
          {item.year ?? '—'}
          {genreNames.length ? ` · ${genreNames.join(', ')}` : ''}
        </p>
        {item.overview && (
          <p className="line-clamp-2 text-[11px] leading-snug text-mist-400">{item.overview}</p>
        )}
        <button
          type="button"
          onClick={onSearch}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-md border border-accent-600/50 bg-accent-600/15 px-2 py-1.5 text-[11px] font-medium text-accent-400 transition-colors hover:bg-accent-600/30"
        >
          <Search size={12} /> Find torrents
        </button>
      </div>
    </article>
  )
}
