import { Play, TriangleAlert } from 'lucide-react'
import { formatBytes, formatCount, timeAgo } from '../../../shared/filters.ts'
import type { ProviderHealth, TorrentResult } from '../../../shared/types.ts'
import { useUiStore } from '../lib/store.ts'

interface ResultListProps {
  results: TorrentResult[]
  isLoading: boolean
  error: Error | null
  hasQuery: boolean
  providers: ProviderHealth[]
  elapsedMs: number
  onPlay: (result: TorrentResult) => void
  pendingInfoHash?: string
}

export function ResultList({
  results,
  isLoading,
  error,
  hasQuery,
  providers,
  elapsedMs,
  onPlay,
  pendingInfoHash
}: ResultListProps) {
  const selected = useUiStore((state) => state.selected)
  const select = useUiStore((state) => state.select)

  if (!hasQuery) {
    return (
      <EmptyState
        title="Search for something to watch"
        body="Try a title, a director, or a series name. Results come from several public indexes in parallel."
      />
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Search failed"
        body={error.message}
        tone="error"
        hint="If the network blocks these hosts, configure a proxy in Settings."
      />
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-[68px] animate-pulse rounded-lg bg-ink-800" />
        ))}
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <EmptyState
        title="No results"
        body="Nothing matched this query with the current filters."
        hint={providers.some((p) => !p.reachable) ? 'Some indexes were unreachable — see Diagnostics.' : undefined}
      />
    )
  }

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink-700 bg-ink-900/95 px-4 py-2.5 backdrop-blur">
        <span className="text-sm font-medium text-mist-100">{results.length} results</span>
        <span className="text-xs text-mist-400">{elapsedMs}ms</span>
        <div className="ml-auto flex items-center gap-1.5">
          {providers
            .filter((provider) => provider.enabled)
            .map((provider) => (
              <span
                key={provider.id}
                title={`${provider.name}: ${provider.reachable ? `${provider.resultCount ?? 0} results` : provider.error ?? 'unreachable'}`}
                className={`h-2 w-2 rounded-full ${
                  provider.reachable ? 'bg-good-500' : 'bg-bad-500/70'
                }`}
              />
            ))}
        </div>
      </div>

      <div className="divide-y divide-ink-800">
        {results.map((result) => (
          <ResultRow
            key={result.id}
            result={result}
            active={selected?.id === result.id}
            pending={pendingInfoHash !== undefined && pendingInfoHash === result.infoHash}
            onSelect={() => select(result)}
            onPlay={() => onPlay(result)}
          />
        ))}
      </div>
    </div>
  )
}

function ResultRow({
  result,
  active,
  pending,
  onSelect,
  onPlay
}: {
  result: TorrentResult
  active: boolean
  pending: boolean
  onSelect: () => void
  onPlay: () => void
}) {
  const release = result.release
  const chips = [
    release.resolution !== 'unknown' ? release.resolution : null,
    release.source !== 'unknown' ? release.source : null,
    release.codec !== 'unknown' ? release.codec : null,
    release.hdr ? 'HDR' : null,
    release.is3d ? '3D' : null,
    release.proper ? 'PROPER' : null
  ].filter(Boolean) as string[]

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
        active ? 'bg-ink-800' : 'hover:bg-ink-850'
      }`}
    >
      <button
        onClick={(event) => {
          event.stopPropagation()
          onPlay()
        }}
        title="Play now"
        aria-label={pending ? `Starting ${result.name}` : `Play ${result.name}`}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          pending
            ? 'border-accent-500 bg-accent-600/30 text-accent-400'
            : 'border-ink-600 bg-ink-800 text-mist-400 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 hover:border-accent-500 hover:text-accent-400'
        }`}
      >
        <Play size={14} className={pending ? 'spin' : ''} fill="currentColor" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="truncate text-sm text-mist-100">{result.name}</span>
          {result.seeders === 0 && (
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn-500" aria-label="no seeders" />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mist-400">
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-mist-400">{result.providerLabel}</span>
          {chips.map((chip) => (
            <span key={chip} className="rounded bg-ink-700/70 px-1.5 py-0.5 text-mist-200">
              {chip}
            </span>
          ))}
          {release.year && <span>{release.year}</span>}
          <span>{formatBytes(result.size)}</span>
          {result.addedAt && <span>{timeAgo(result.addedAt)}</span>}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-sm font-medium text-good-500">{formatCount(result.seeders)}</div>
        <div className="text-[11px] text-mist-400">{formatCount(result.leechers)} leecher{result.leechers === 1 ? '' : 's'}</div>
      </div>
    </div>
  )
}

function EmptyState({
  title,
  body,
  hint,
  tone = 'neutral'
}: {
  title: string
  body: string
  hint?: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <h2 className={`text-lg font-medium ${tone === 'error' ? 'text-bad-500' : 'text-mist-100'}`}>{title}</h2>
      <p className="max-w-md text-sm text-mist-400">{body}</p>
      {hint && <p className="max-w-md text-xs text-warn-500">{hint}</p>}
    </div>
  )
}
