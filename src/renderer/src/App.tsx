import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { applyFilters } from '../../shared/filters.ts'
import { DEFAULT_FILTERS, type TorrentResult } from '../../shared/types.ts'
import { api } from './lib/api.ts'
import { useUiStore } from './lib/store.ts'
import { DetailPanel } from './components/DetailPanel.tsx'
import { DiagnosticsPanel } from './components/DiagnosticsPanel.tsx'
import { FilterPanel } from './components/FilterPanel.tsx'
import { LibraryPanel } from './components/LibraryPanel.tsx'
import { Player } from './components/Player.tsx'
import { ResultList } from './components/ResultList.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { TopBar } from './components/TopBar.tsx'
import { useTorrentSession } from './hooks/useTorrentSession.ts'

export default function App() {
  const { submitted, filters, panel, player, closePlayer } = useUiStore()
  const [pendingResult, setPendingResult] = useState<TorrentResult | null>(null)
  const autoOpenedRef = useRef<string | null>(null)
  const { session, error, start, reset, pickFile, stopTorrent, setPaused, resumeFromLibrary } =
    useTorrentSession()

  const themeKey = filters.themes.join(',')
  const queryClient = useQueryClient()

  const searchQuery = useQuery({
    queryKey: ['search', submitted, themeKey],
    queryFn: () =>
      api.search({
        query: submitted,
        filters: { ...DEFAULT_FILTERS, themes: filters.themes }
      }),
    enabled: submitted.length > 0,
    staleTime: 60_000
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settingsGet(),
    staleTime: Infinity
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
  // spinner never stops spinning.
  const handleStop = useCallback(async () => {
    setPendingResult(null)
    await stopTorrent()
  }, [stopTorrent])

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
        engine={settingsQuery.data?.engine ?? 'builtin'}
        onEngineChange={(engine) => {
          // Send only the key being changed — spreading the cached snapshot
          // would clobber concurrent settings edits with stale values.
          void (async () => {
            try {
              await api.settingsSet({ engine })
              await queryClient.invalidateQueries({ queryKey: ['settings'] })
            } catch (error) {
              console.error('[settings] engine switch failed', (error as Error).message)
            }
          })()
        }}
      />

      <div className="flex min-h-0 flex-1">
        <FilterPanel results={searchQuery.data?.results ?? []} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <ResultList
            results={results}
            isLoading={searchQuery.isLoading}
            error={searchQuery.error as Error | null}
            hasQuery={submitted.length > 0}
            providers={searchQuery.data?.providers ?? []}
            elapsedMs={searchQuery.data?.elapsedMs ?? 0}
            onPlay={handlePlay}
            pendingInfoHash={pendingResult?.infoHash}
          />
        </main>

        <DetailPanel
          onPlay={handlePlay}
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
