import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Film,
  FolderOpen,
  FolderInput,
  ListMinus,
  Loader2,
  Play,
  RotateCw,
  Trash2,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { formatBytes, formatDuration } from '../../../shared/filters.ts'
import type { DownloadItem, LibraryEntry } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'
import { Overlay } from './SettingsPanel.tsx'

interface LibraryPanelProps {
  /** Start playback of a continue-watching entry from where it stopped. */
  onResume: (entry: LibraryEntry) => void
}

type Tab = 'downloaded' | 'watching'

export function LibraryPanel({ onResume }: LibraryPanelProps) {
  const setPanel = useUiStore((state) => state.setPanel)
  const openPlayer = useUiStore((state) => state.openPlayer)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('downloaded')
  const [scanning, setScanning] = useState(false)
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null)
  const [resumingId, setResumingId] = useState<string | null>(null)

  // Poll while the panel is mounted so progress bars move during playback.
  const library = useQuery({
    queryKey: ['library'],
    queryFn: () => api.libraryList(),
    staleTime: 5000,
    refetchInterval: 5000
  })

  const downloads = useQuery({
    queryKey: ['downloads'],
    queryFn: () => api.downloadsList(),
    staleTime: 5000,
    refetchInterval: 5000
  })

  // Disarm the two-step remove after a few seconds.
  useEffect(() => {
    if (!armedRemoveId) return
    const timer = setTimeout(() => setArmedRemoveId(null), 4000)
    return () => clearTimeout(timer)
  }, [armedRemoveId])

  const watchById = new Map((library.data ?? []).map((entry) => [entry.infoHash, entry]))

  const playItem = (item: DownloadItem) => {
    const primaryIndex = primaryVideoIndex(item)
    if (primaryIndex === -1) {
      toast.error('No playable video file in this download yet')
      return
    }
    const watch = watchById.get(item.id)
    const seekTo =
      watch?.durationSec && watch.positionSec <= watch.durationSec - 5 ? watch.positionSec : 0
    openPlayer(item.id, primaryIndex, {
      resumePositionSec: seekTo,
      title: item.title,
      theme: item.theme,
      imdbId: watch?.imdbId
    })
    setPanel('none')
  }

  const resumeDownload = async (item: DownloadItem) => {
    if (!item.infoHash) return
    setResumingId(item.id)
    try {
      await api.torrentAdd({
        magnet: `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.name)}`,
        title: item.name,
        infoHash: item.infoHash
      })
      toast.success('Download resumed')
      await downloads.refetch()
    } catch (error) {
      toast.error(`Could not resume: ${(error as Error).message}`)
    } finally {
      setResumingId(null)
    }
  }

  const runScan = async () => {
    setScanning(true)
    try {
      const { added, skipped } = await api.downloadsScan()
      toast.success(
        added > 0
          ? `Imported ${added} item${added === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} already tracked` : ''}`
          : skipped > 0
            ? `Everything already tracked (${skipped})`
            : 'No video files found in the download folder'
      )
      await queryClient.invalidateQueries({ queryKey: ['downloads'] })
    } catch (error) {
      toast.error(`Scan failed: ${(error as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  const removeItem = async (item: DownloadItem, deleteFiles: boolean) => {
    setArmedRemoveId(null)
    try {
      const { failed } = await api.downloadsRemove(item.id, deleteFiles)
      if (failed.length > 0) {
        toast.error(`Removed from library, but ${failed.length} file(s) could not be deleted`)
      } else if (deleteFiles) {
        toast.success('Removed from library — files deleted from disk')
      } else {
        toast.success('Removed from library (files kept on disk)')
      }
    } catch (error) {
      toast.error(`Remove failed: ${(error as Error).message}`)
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['downloads'] }),
      queryClient.invalidateQueries({ queryKey: ['library'] })
    ])
  }

  return (
    <Overlay onClose={() => setPanel('none')} label="Library">
      <header className="flex items-center gap-3 border-b border-ink-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-mist-100">Library</h2>
        <div className="flex overflow-hidden rounded-lg border border-ink-600">
          {(
            [
              { id: 'downloaded', label: 'Downloaded' },
              { id: 'watching', label: 'Continue watching' }
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              aria-pressed={tab === entry.id}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === entry.id
                  ? 'bg-accent-600 text-white'
                  : 'bg-ink-800 text-mist-400 hover:text-mist-100'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {tab === 'downloaded' ? (
          <button
            onClick={() => void runScan()}
            disabled={scanning}
            title="Scan the download folder for video files that are not yet tracked"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-mist-200 transition-colors hover:text-mist-100 disabled:opacity-50"
          >
            {scanning ? <Loader2 size={12} className="spin" /> : <FolderInput size={12} />}
            Import
          </button>
        ) : (
          <button
            onClick={() => void library.refetch()}
            disabled={library.isFetching}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-mist-200 hover:text-mist-100 disabled:opacity-60"
          >
            {library.isFetching && <Loader2 size={12} className="spin" />}
            Refresh
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'downloaded' ? (
          <DownloadedList
            isLoading={downloads.isLoading}
            isError={downloads.isError}
            error={downloads.error as Error | null}
            items={downloads.data ?? []}
            armedRemoveId={armedRemoveId}
            resumingId={resumingId}
            onPlay={playItem}
            onResume={resumeDownload}
            onArmRemove={setArmedRemoveId}
            onRemove={removeItem}
            onReveal={(item) =>
              void api
                .downloadsReveal(item.id)
                .then((ok) => {
                  if (ok === false) toast.error('Could not reveal that file — it may have moved')
                })
                .catch((err) => toast.error(`Reveal failed: ${(err as Error).message}`))
            }
            onRetry={() => void downloads.refetch()}
          />
        ) : (
          <ContinueWatchingList
            isLoading={library.isLoading}
            isError={library.isError}
            error={library.error as Error | null}
            entries={library.data ?? []}
            onResume={onResume}
            onRetry={() => void library.refetch()}
          />
        )}
      </div>
    </Overlay>
  )
}

function primaryVideoIndex(item: DownloadItem): number {
  let best = -1
  let bestSize = -1
  item.files.forEach((file, index) => {
    if (file.isVideo && file.size > bestSize) {
      bestSize = file.size
      best = index
    }
  })
  return best
}

function totalSize(item: DownloadItem): number {
  return item.files.filter((file) => file.isVideo).reduce((sum, file) => sum + file.size, 0)
}

const STATUS_STYLES: Record<DownloadItem['status'], { label: string; className: string }> = {
  downloading: { label: 'Downloading', className: 'bg-accent-600/15 text-accent-400' },
  paused: { label: 'Paused', className: 'bg-warn-500/15 text-warn-500' },
  error: { label: 'Error', className: 'bg-bad-500/15 text-bad-500' },
  complete: { label: 'Downloaded', className: 'bg-good-500/15 text-good-500' },
  missing: { label: 'Missing', className: 'bg-warn-500/15 text-warn-500' }
}

function DownloadedList({
  isLoading,
  isError,
  error,
  items,
  armedRemoveId,
  resumingId,
  onPlay,
  onResume,
  onArmRemove,
  onRemove,
  onReveal,
  onRetry
}: {
  isLoading: boolean
  isError: boolean
  error: Error | null
  items: DownloadItem[]
  armedRemoveId: string | null
  resumingId: string | null
  onPlay: (item: DownloadItem) => void
  onResume: (item: DownloadItem) => void
  onArmRemove: (id: string | null) => void
  onRemove: (item: DownloadItem, deleteFiles: boolean) => void
  onReveal: (item: DownloadItem) => void
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-mist-400">
        <Loader2 size={16} className="spin" />
        Loading downloads…
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
        Could not load downloads: {error?.message}
        <button onClick={onRetry} className="ml-2 underline hover:text-mist-100">
          Retry
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-mist-400">
        <Film size={28} className="mx-auto mb-3 text-mist-400" />
        <p>Nothing here yet.</p>
        <p className="mt-1 text-xs">
          Use the <span className="text-mist-200">Download</span> button next to “Play now”, or
          press <span className="text-mist-200">Import</span> to archive movies already in your
          download folder.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const percent = Math.round(item.progress * 100)
        const size = totalSize(item)
        const status = STATUS_STYLES[item.status]
        const armed = armedRemoveId === item.id
        const canPlay = item.status === 'complete'
        const canResume = item.kind === 'torrent' && item.status !== 'complete' && item.infoHash

        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5"
          >
            <button
              onClick={() => canPlay && onPlay(item)}
              disabled={!canPlay}
              aria-label={canPlay ? `Play ${item.title}` : `${item.title} (not playable yet)`}
              title={canPlay ? `Play ${item.title}` : 'Available once the download finishes'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent-600/50 bg-accent-600/10 text-accent-400 transition-colors hover:bg-accent-600/20 disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-ink-700 disabled:text-mist-400"
            >
              <Play size={16} fill="currentColor" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-xs text-mist-100">
                  {item.title}
                  {item.year && <span className="text-mist-400"> ({item.year})</span>}
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${status.className}`}
                >
                  {status.label}
                </span>
              </div>

              {item.status === 'downloading' || item.status === 'paused' ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-ink-600">
                    <div
                      className={`h-full ${item.status === 'paused' ? 'bg-warn-500' : 'bg-accent-500'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-mist-400">{percent}%</span>
                </div>
              ) : (
                <div className="mt-1 text-[10px] text-mist-400">
                  {item.status === 'missing' ? (
                    'File not found on disk'
                  ) : (
                    <>
                      {size > 0 ? formatBytes(size) : 'Size unknown'}
                      {item.completedAt && (
                        <> · {new Date(item.completedAt).toLocaleDateString()}</>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {canResume && (
              <button
                onClick={() => onResume(item)}
                disabled={resumingId === item.id}
                title="Resume this download"
                aria-label={`Re-add ${item.title} to continue downloading`}
                className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-accent-400 disabled:opacity-50"
              >
                {resumingId === item.id ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RotateCw size={14} />
                )}
              </button>
            )}

            <button
              onClick={() => onReveal(item)}
              title="Reveal in folder"
              aria-label={`Reveal ${item.title} in folder`}
              className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-100"
            >
              <FolderOpen size={14} />
            </button>

            {armed ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void onRemove(item, false)}
                  title="Remove from library only (keeps files on disk)"
                  aria-label={`Remove ${item.title} from library, keep files`}
                  className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-100"
                >
                  <ListMinus size={14} />
                </button>
                <button
                  onClick={() => void onRemove(item, true)}
                  title="Delete the release folder and everything in it from disk"
                  aria-label={`Delete the release folder for ${item.title}, including all its files`}
                  className="rounded border border-bad-500/50 bg-bad-500/15 p-1.5 text-bad-500 transition-colors hover:bg-bad-500/25"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => onArmRemove(null)}
                  title="Cancel"
                  aria-label="Cancel remove"
                  className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-100"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                title="Remove from library"
                aria-label={`Remove ${item.title} from library`}
                onClick={() => onArmRemove(item.id)}
                className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-bad-500"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ContinueWatchingList({
  isLoading,
  isError,
  error,
  entries,
  onResume,
  onRetry
}: {
  isLoading: boolean
  isError: boolean
  error: Error | null
  entries: LibraryEntry[]
  onResume: (entry: LibraryEntry) => void
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-mist-400">
        <Loader2 size={16} className="spin" />
        Loading library…
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
        Could not load the library: {error?.message}
        <button onClick={onRetry} className="ml-2 underline hover:text-mist-100">
          Retry
        </button>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-mist-400">
        Nothing here yet. Play something and your position is saved.
      </p>
    )
  }

  return <WatchingList entries={entries} onResume={onResume} />
}

function WatchingList({
  entries,
  onResume
}: {
  entries: LibraryEntry[]
  onResume: (entry: LibraryEntry) => void
}) {
  const queryClient = useQueryClient()
  const [armedId, setArmedId] = useState<string | null>(null)

  // Disarm the two-step remove after a few seconds.
  useEffect(() => {
    if (!armedId) return
    const timer = setTimeout(() => setArmedId(null), 4000)
    return () => clearTimeout(timer)
  }, [armedId])

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry) => {
        const armed = armedId === entry.infoHash
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
              <div className="truncate text-xs text-mist-100" title={entry.title}>{entry.title}</div>
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
              title={armed ? 'Click again to remove' : 'Remove from library'}
              aria-label={
                armed
                  ? `Confirm removal of ${entry.title} from the library`
                  : `Remove ${entry.title} from library`
              }
              onClick={() => {
                if (!armed) {
                  setArmedId(entry.infoHash)
                  return
                }
                setArmedId(null)
                void (async () => {
                  try {
                    await api.libraryRemove(entry.infoHash)
                    toast.success('Removed from Continue watching')
                  } catch (err) {
                    toast.error(`Could not remove: ${(err as Error).message}`)
                  }
                  await queryClient.invalidateQueries({ queryKey: ['library'] })
                })()
              }}
              className={`rounded p-1.5 transition-colors ${
                armed
                  ? 'border border-bad-500/50 bg-bad-500/15 text-bad-500 hover:bg-bad-500/25'
                  : 'text-mist-400 hover:bg-ink-700 hover:text-bad-500'
              }`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
