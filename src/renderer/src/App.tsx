import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { applyFilters } from '../../shared/filters.ts'
import { BROWSE_CATEGORIES } from '../../shared/discover.ts'
import { DEFAULT_FILTERS, type TorrentResult } from '../../shared/types.ts'
import { api } from './lib/api.ts'
import { toast } from 'sonner'
import { useUiStore } from './lib/store.ts'
import { BrowseStrip } from './components/BrowseStrip.tsx'
import { DetailPanel } from './components/DetailPanel.tsx'
import { DiagnosticsPanel } from './components/DiagnosticsPanel.tsx'
import { DiscoverPanel } from './components/DiscoverPanel.tsx'
import { FilterPanel } from './components/FilterPanel.tsx'
import { LibraryPanel } from './components/LibraryPanel.tsx'
import { Player } from './components/Player.tsx'
import { ResultList } from './components/ResultList.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { TopBar } from './components/TopBar.tsx'
import { ViewTabs } from './components/ViewTabs.tsx'
import { useTorrentSession } from './hooks/useTorrentSession.ts'

export default function App() {
  const submitted = useUiStore((state) => state.submitted)
  const filters = useUiStore((state) => state.filters)
  const view = useUiStore((state) => state.view)
  const browseCategory = useUiStore((state) => state.browseCategory)
  const panel = useUiStore((state) => state.panel)
  const player = useUiStore((state) => state.player)
  const closePlayer = useUiStore((state) => state.closePlayer)
  const [pendingResult, setPendingResult] = useState<TorrentResult | null>(null)
  const autoOpenedRef = useRef<string | null>(null)
  const { session, error, start, download, reset, pickFile, stopTorrent, setPaused, resumeFromLibrary } =
    useTorrentSession()

  const themeKey = filters.themes.join(',')
  const queryClient = useQueryClient()
  const activeCategory =
    BROWSE_CATEGORIES.find((entry) => entry.id === browseCategory) ?? BROWSE_CATEGORIES[0]
  const isBrowse = view === 'browse'

  const searchQuery = useQuery({
    queryKey: ['search', view, isBrowse ? activeCategory.id : submitted, themeKey],
    queryFn: () =>
      api.search({
        // Browse has no text query: indexes return their newest rows for the
        // selected category instead. Quality filters still run client-side.
        query: isBrowse ? '' : submitted,
        filters: {
          ...DEFAULT_FILTERS,
          themes: filters.themes,
          category: isBrowse ? activeCategory.category ?? '' : ''
        }
      }),
    enabled: isBrowse || submitted.length > 0,
    staleTime: 60_000
  })

  const results = useMemo(
    () => applyFilters(searchQuery.data?.results ?? [], filters),
    [searchQuery.data?.results, filters]
  )

  const handlePlay = useCallback(
    async (result: TorrentResult) => {
      autoOpenedRef.current = null
      setPendingResult(result)
      reset()
      try {
        await start(result)
      } catch {
        // useTorrentSession.start already toasted and recorded the error.
        setPendingResult(null)
      }
    },
    [start, reset]
  )

  // Stop the download AND clear the pending state, otherwise the row
  // spinner never stops spinning. A disk-played download has no live engine
  // session of its own (activeSessionId is null), so stopTorrent is a no-op
  // and we just close.
  const handleStop = useCallback(async () => {
    setPendingResult(null)
    if (session) {
      await stopTorrent()
    }
  }, [stopTorrent, session])

  // Toast when a download completes and refresh the library panel.
  useEffect(() => {
    return api.onDownloadComplete((item) => {
      toast.success(`Finished downloading “${item.title}”`)
      void queryClient.invalidateQueries({ queryKey: ['downloads'] })
    })
  }, [queryClient])

  // Once metadata arrives and the torrent has exactly one video file, play it.
  // Only once per session: closing the player must not reopen it.
  useEffect(() => {
    if (!session || session.state === 'error') return
    if (!pendingResult) return
    if (autoOpenedRef.current === session.sessionId) return
    const videos = session.files.filter((file) => file.isVideo)
    if (videos.length === 1) {
      autoOpenedRef.current = session.sessionId
      setPendingResult(null)
      void pickFile(session.sessionId, videos[0].index, {
        title: pendingResult.release.title,
        theme: pendingResult.theme,
        imdbId: pendingResult.imdbId
      })
    }
  }, [session, pendingResult, pickFile])

  useEffect(() => {
    if (session?.state === 'error' && pendingResult) {
      setPendingResult(null)
    }
  }, [session?.state, pendingResult])

  return (
    <div className="flex h-full flex-col bg-ink-900 text-mist-100">
      <TopBar
        onOpenSettings={() => useUiStore.getState().setPanel('settings')}
        onOpenLibrary={() => useUiStore.getState().setPanel('library')}
        onOpenDiagnostics={() => useUiStore.getState().setPanel('diagnostics')}
      />

      <ViewTabs />

      <div className="flex min-h-0 flex-1">
        {view !== 'discover' && <FilterPanel results={searchQuery.data?.results ?? []} />}

        {view === 'discover' ? (
          <main className="min-w-0 flex-1">
            <DiscoverPanel />
          </main>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            {isBrowse && <BrowseStrip />}
            <main className="min-w-0 flex-1 overflow-y-auto">
              <ResultList
                results={results}
                isLoading={searchQuery.isLoading}
                error={searchQuery.error as Error | null}
                hasQuery={isBrowse || submitted.length > 0}
                providers={searchQuery.data?.providers ?? []}
                elapsedMs={searchQuery.data?.elapsedMs ?? 0}
                onPlay={handlePlay}
                pendingInfoHash={pendingResult?.infoHash}
                emptyTitle={isBrowse ? 'Nothing in this category' : undefined}
                emptyBody={
                  isBrowse
                    ? 'Try another category or relax the quality filters on the left.'
                    : undefined
                }
              />
            </main>
          </div>
        )}

        <DetailPanel
          onPlay={handlePlay}
          onDownload={(result) => {
            void download(result).catch(() => {
              // useTorrentSession.download already toasted; swallow so the
              // call site never leaks an unhandled rejection.
            })
          }}
          session={session}
          error={error}
          onPickFile={pickFile}
          onStopSession={handleStop}
          onPauseSession={setPaused}
          pendingResult={pendingResult}
        />
      </div>

      {panel === 'settings' && <SettingsPanel />}
      {panel === 'library' && (
        <LibraryPanel
          onResume={(entry) => {
            void resumeFromLibrary(entry)
            useUiStore.getState().setPanel('none')
          }}
        />
      )}
      {panel === 'diagnostics' && <DiagnosticsPanel />}

      {player && (
        <Player
          sessionId={player.sessionId}
          fileIndex={player.fileIndex}
          resumePositionSec={player.resumePositionSec}
          title={player.title}
          theme={player.theme}
          imdbId={player.imdbId}
          onClose={closePlayer}
          onStop={() => {
            void handleStop().finally(() => closePlayer())
          }}
        />
      )}
    </div>
  )
}
