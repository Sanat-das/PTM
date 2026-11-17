import { useQuery } from '@tanstack/react-query'
import { Loader2, Play, Trash2 } from 'lucide-react'
import { formatDuration } from '../../../shared/filters.ts'
import type { LibraryEntry } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'
import { Overlay } from './SettingsPanel.tsx'

interface LibraryPanelProps {
  /** Start playback of an entry from where it stopped. */
  onResume: (entry: LibraryEntry) => void
}

export function LibraryPanel({ onResume }: LibraryPanelProps) {
  const setPanel = useUiStore((state) => state.setPanel)

  const library = useQuery({
    queryKey: ['library'],
    queryFn: () => api.libraryList(),
    staleTime: 5000
  })

  return (
    <Overlay onClose={() => setPanel('none')} label="Continue watching">
      <header className="flex items-center border-b border-ink-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-mist-100">Continue watching</h2>
        <button
          onClick={() => void library.refetch()}
          className="ml-auto rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-mist-200 hover:text-mist-100"
        >
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {library.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-mist-400">
            <Loader2 size={16} className="spin" />
            Loading library…
          </div>
        )}

        {library.isError && (
          <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
            Could not load the library: {(library.error as Error).message}
            <button onClick={() => void library.refetch()} className="ml-2 underline hover:text-mist-100">
              Retry
            </button>
          </div>
        )}

        {library.data?.length === 0 && (
          <p className="py-6 text-center text-sm text-mist-400">
            Nothing here yet. Play something and your position is saved.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {library.data?.map((entry) => {
            const remaining = entry.durationSec ? Math.max(0, entry.durationSec - entry.positionSec) : 0
            const percent = entry.durationSec
              ? Math.min(100, (entry.positionSec / entry.durationSec) * 100)
              : 0
            const finished =
              entry.durationSec !== undefined && entry.positionSec > entry.durationSec - 5

            return (
              <div
                key={entry.infoHash}
                className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5"
              >
                <button
                  onClick={() => onResume(entry)}
                  aria-label={finished ? 'Watch again from the beginning' : 'Resume from saved position'}
                  title={finished ? 'Watch again from the beginning' : `Resume from ${formatDuration(entry.positionSec)}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent-600/50 bg-accent-600/10 text-accent-400 transition-colors hover:bg-accent-600/20"
                >
                  <Play size={16} fill="currentColor" />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-mist-100">{entry.title}</div>
                  <div className="mt-1 h-1 w-full max-w-xs overflow-hidden rounded-full bg-ink-600">
                    <div className="h-full bg-accent-500" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-mist-400">
                    <span>
                      {formatDuration(entry.positionSec)}
                      {entry.durationSec ? ` / ${formatDuration(entry.durationSec)}` : ''}
                    </span>
                    {entry.durationSec && (
                      <>
                        <span>·</span>
                        <span>{finished ? 'finished — play again' : `${formatDuration(remaining)} left`}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  title="Remove from library"
                  aria-label={`Remove ${entry.title} from library`}
                  onClick={() => {
                    void (async () => {
                      try {
                        await api.libraryRemove(entry.infoHash)
                      } catch {
                        // Row stays in place; the user can retry.
                      }
                      await library.refetch()
                    })()
                  }}
                  className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-bad-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </Overlay>
  )
}
