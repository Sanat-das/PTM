import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Download, ExternalLink, Octagon, Pause, Play, Star, Users } from 'lucide-react'
import { formatBytes, formatCount } from '../../../shared/filters.ts'
import type { TorrentStatus } from '../../../shared/ipc.ts'
import type { TorrentResult } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

interface DetailPanelProps {
  onPlay: (result: TorrentResult) => void
  session: TorrentStatus | null
  error: string | null
  onPickFile: (sessionId: string, fileIndex: number) => void
  onStopSession: () => void | Promise<void>
  onPauseSession: (paused: boolean) => void | Promise<void>
  pendingResult: TorrentResult | null
}

export function DetailPanel({
  onPlay,
  session,
  error,
  onPickFile,
  onStopSession,
  onPauseSession,
  pendingResult
}: DetailPanelProps) {
  const selected = useUiStore((state) => state.selected)

  const metadataQuery = useQuery({
    queryKey: ['metadata', selected?.release.title, selected?.release.year, selected?.imdbId],
    queryFn: () =>
      api.metadata(
        selected!.release.title,
        selected!.release.year,
        selected!.imdbId
      ),
    enabled: Boolean(selected),
    staleTime: 10 * 60_000
  })

  const trailersQuery = useQuery({
    queryKey: ['trailers', selected?.release.title, selected?.release.year],
    queryFn: () => api.youtubeTrailers(selected!.release.title, selected!.release.year),
    enabled: Boolean(selected),
    staleTime: 10 * 60_000
  })

  if (!selected && !session) {
    return (
      <aside className="flex w-[380px] shrink-0 items-center justify-center border-l border-ink-700 bg-ink-850 p-8 text-center">
        <p className="text-sm text-mist-400">Select a result to see details and trailers.</p>
      </aside>
    )
  }

  const metadata = metadataQuery.data
  const title = selected?.release.title ?? session?.name ?? ''
  const year = selected?.release.year

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-ink-700 bg-ink-850">
      {metadata?.poster && (
        <div className="relative h-52 w-full shrink-0 overflow-hidden">
          <img src={metadata.backdrop ?? metadata.poster} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-850 via-ink-850/40 to-transparent" />
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        <div>
          <h1 className="text-base font-semibold leading-snug text-mist-100">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mist-400">
            {year && <span>{year}</span>}
            {metadata?.rating != null && (
              <span className="flex items-center gap-1 text-warn-500">
                <Star size={11} fill="currentColor" />
                {metadata.rating.toFixed(1)}
              </span>
            )}
            {metadata?.runtimeMinutes && <span>{metadata.runtimeMinutes} min</span>}
            {metadata?.genres?.slice(0, 3).map((genre) => (
              <span key={genre} className="rounded bg-ink-700 px-1.5 py-0.5">
                {genre}
              </span>
            ))}
          </div>
          {metadata?.synopsis && (
            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-mist-400">{metadata.synopsis}</p>
          )}
        </div>

        {selected && (
          <>
            <button
              onClick={() => onPlay(selected)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-500"
            >
              <Play size={15} fill="currentColor" />
              Play now
            </button>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-ink-700 bg-ink-800 p-3 text-xs">
              <Detail label="Provider" value={selected.providerLabel} />
              <Detail label="Size" value={formatBytes(selected.size)} />
              <Detail
                label="Seeders"
                value={`${formatCount(selected.seeders)} / ${formatCount(selected.leechers)}`}
              />
              <Detail label="Theme" value={selected.theme} />
              {selected.release.group && <Detail label="Group" value={selected.release.group} />}
              {selected.imdbId && <Detail label="IMDb" value={selected.imdbId} />}
            </dl>

            <p className="break-all font-mono text-[10px] leading-relaxed text-mist-400/70">
              {selected.name}
            </p>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 p-3 text-xs text-bad-500">
            {error}
          </div>
        )}

        {session?.error && (
          <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 p-3 text-xs leading-relaxed text-bad-500">
            {session.error}
          </div>
        )}

        {session && (
          <SessionPanel
            session={session}
            onPickFile={onPickFile}
            onPauseSession={onPauseSession}
            onStopSession={onStopSession}
          />
        )}

        {selected && (
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-mist-400">
              <Clapperboard size={12} />
              Trailers
            </h2>
            <Trailers
              isLoading={trailersQuery.isLoading}
              error={trailersQuery.error as Error | null}
              videos={trailersQuery.data ?? []}
              title={title}
            />
          </section>
        )}

        {pendingResult && !session && (
          <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 p-3 text-xs text-mist-400">
            <Download size={13} className="spin" />
            Fetching torrent metadata…
          </div>
        )}
      </div>
    </aside>
  )
}

function SessionPanel({
  session,
  onPickFile,
  onPauseSession,
  onStopSession
}: {
  session: TorrentStatus
  onPickFile: (sessionId: string, fileIndex: number) => void
  onPauseSession: (paused: boolean) => void | Promise<void>
  onStopSession: () => void | Promise<void>
}) {
  const videos = session.files.filter((file) => file.isVideo)
  const subtitles = session.files.filter((file) => file.isSubtitle)
  const percent = Math.round(session.progress * 100)

  const stateTone =
    session.state === 'paused'
      ? 'bg-warn-500/15 text-warn-500'
      : session.state === 'complete'
        ? 'bg-good-500/15 text-good-500'
        : session.state === 'error'
          ? 'bg-bad-500/15 text-bad-500'
          : 'bg-accent-600/20 text-accent-400'

  return (
    <section className="rounded-lg border border-ink-600 bg-ink-800 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Users size={13} className="text-mist-400" />
        <span className="text-mist-200">{session.numPeers} peers</span>
        <span className="text-mist-400">·</span>
        <span className="text-mist-200">{formatBytes(session.downloadSpeed)}/s down</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${stateTone}`}>
          {session.state}
        </span>
      </div>

      {session.progress > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-600">
            <div
              className={`h-full transition-all ${session.paused ? 'bg-warn-500' : 'bg-accent-500'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-mist-400">
            {percent}%
          </span>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void onPauseSession(!session.paused)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
        >
          {session.paused ? (
            <>
              <Play size={12} fill="currentColor" /> Resume
            </>
          ) : (
            <>
              <Pause size={12} fill="currentColor" /> Pause
            </>
          )}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Stop this torrent? Downloaded files stay on disk.')) {
              void onStopSession()
            }
          }}
          title="Stop this torrent"
          aria-label="Stop this torrent"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-bad-500/40 bg-bad-500/10 px-2 py-1.5 text-xs text-bad-500 transition-colors hover:bg-bad-500/20"
        >
          <Octagon size={12} fill="currentColor" />
          Stop
        </button>
      </div>

      {videos.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-mist-400">
            Video files
          </span>
          {videos.map((file) => (
            <button
              key={file.index}
              onClick={() => onPickFile(session.sessionId, file.index)}
              className="flex items-center gap-2 rounded border border-ink-600 bg-ink-850 px-2 py-1.5 text-left text-xs text-mist-200 transition-colors hover:border-accent-500 hover:text-accent-400"
            >
              <Play size={11} fill="currentColor" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-[10px] text-mist-400">{formatBytes(file.size)}</span>
            </button>
          ))}
        </div>
      )}

      {subtitles.length > 0 && (
        <div className="mt-2 text-[10px] text-mist-400">
          {subtitles.length} subtitle file{subtitles.length === 1 ? '' : 's'} available in the
          player's captions menu
        </div>
      )}
    </section>
  )
}

function Trailers({
  isLoading,
  error,
  videos,
  title
}: {
  isLoading: boolean
  error: Error | null
  videos: Array<{
    id: string
    title: string
    channel: string
    views: number
    durationText?: string
    publishedText?: string
    thumbnail?: string
    url: string
  }>
  title: string
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded bg-ink-800" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="rounded border border-bad-500/30 bg-bad-500/10 p-2 text-xs text-bad-500">{error.message}</p>
  }

  if (videos.length === 0) {
    return <p className="text-xs text-mist-400">No trailers found for “{title}”.</p>
  }

  return (
    <div className="flex flex-col gap-1.5">
      {videos.slice(0, 6).map((video) => (
        <a
          key={video.id}
          href={video.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault()
            void api.openExternal(video.url)
          }}
          className="group flex gap-2 rounded-lg border border-ink-700 bg-ink-800 p-2 transition-colors hover:border-ink-500"
        >
          {video.thumbnail && (
            <img
              src={video.thumbnail}
              alt=""
              loading="lazy"
              className="h-[54px] w-[96px] shrink-0 rounded object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-xs leading-snug text-mist-200 group-hover:text-accent-400">
              {video.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mist-400">
              <span className="truncate">{video.channel}</span>
              <span>·</span>
              <span>{formatCount(video.views)} views</span>
              {video.publishedText && (
                <>
                  <span>·</span>
                  <span>{video.publishedText}</span>
                </>
              )}
              {video.durationText && (
                <>
                  <span>·</span>
                  <span>{video.durationText}</span>
                </>
              )}
              <ExternalLink size={9} className="ml-auto shrink-0" />
            </div>
          </div>
        </a>
      ))}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wider text-mist-400">{label}</dt>
      <dd className="truncate text-mist-200">{value}</dd>
    </div>
  )
}
