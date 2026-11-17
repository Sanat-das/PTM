import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { TorrentStatus } from '../../../shared/ipc.ts'
import type { LibraryEntry, TorrentResult } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

export function useTorrentSession() {
  const [session, setSession] = useState<TorrentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingResume, setPendingResume] = useState<LibraryEntry | null>(null)
  const activeSessionId = useRef<string | null>(null)
  const openPlayer = useUiStore((state) => state.openPlayer)

  useEffect(() => {
    return api.onTorrentStatus((status) => {
      if (activeSessionId.current && status.sessionId !== activeSessionId.current) return
      setSession(status)
    })
  }, [])

  const start = useCallback(async (result: TorrentResult) => {
    setError(null)
    setPendingResume(null)
    try {
      // Prefer what we already know: a magnet from the provider, or an info
      // hash we can turn into one without another network round-trip.
      let magnet = result.magnet
      if (!magnet && result.infoHash) {
        magnet = `magnet:?xt=urn:btih:${result.infoHash}&dn=${encodeURIComponent(result.name)}`
      }
      if (!magnet && result.url) {
        const resolved = await api.resolveMagnet(result.url)
        if (resolved) magnet = resolved
      }
      if (!magnet && !result.url) {
        throw new Error('Could not find a magnet link for this result')
      }

      const status = await api.torrentAdd({
        magnet,
        url: magnet ? undefined : result.url,
        title: result.name,
        infoHash: result.infoHash
      })
      activeSessionId.current = status.sessionId
      setSession(status)
      return status
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      toast.error(`Could not start download: ${message}`)
      throw err
    }
  }, [])

  const pickFile = useCallback(
    (sessionId: string, fileIndex: number, opts?: { resumePositionSec?: number; title?: string }) => {
      openPlayer(sessionId, fileIndex, opts)
    },
    [openPlayer]
  )

  const stopTorrent = useCallback(async () => {
    const id = activeSessionId.current
    if (!id) return
    try {
      await api.torrentRemove(id)
    } catch (err) {
      console.warn('[session] stop failed', (err as Error).message)
    }
    setSession(null)
    setError(null)
    setPendingResume(null)
    activeSessionId.current = null
  }, [])

  const setPaused = useCallback(
    async (paused: boolean) => {
      const id = activeSessionId.current
      if (!id) return
      const status = await api.torrentSetPaused(id, paused)
      if (status) setSession(status)
    },
    []
  )

  const reset = useCallback(() => {
    setSession(null)
    setError(null)
    setPendingResume(null)
    activeSessionId.current = null
  }, [])

  /**
   * Re-add a torrent that was being watched, using the info hash we stored,
   * and seek to the saved position once metadata arrives.
   */
  const resumeFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      reset()
      setPendingResume(entry)
      const magnet = `magnet:?xt=urn:btih:${entry.infoHash}&dn=${encodeURIComponent(entry.name)}`
      try {
        const status = await api.torrentAdd({
          magnet,
          title: entry.name,
          infoHash: entry.infoHash
        })
        activeSessionId.current = status.sessionId
        setSession(status)
      } catch (err) {
        const message = (err as Error).message
        setPendingResume(null)
        setError(message)
        toast.error(`Could not resume: ${message}`)
        throw err
      }
    },
    [reset]
  )

  // When a resumed torrent's metadata arrives, open the stored file at the saved position.
  useEffect(() => {
    if (!pendingResume || !session || session.state === 'error') return
    const videos = session.files.filter((file) => file.isVideo)
    if (videos.length === 0) return

    const target = Math.min(pendingResume.fileIndex, session.files.length - 1)
    const index = session.files[target]?.isVideo ? target : videos[0].index

    // Treat positions near the end as "finished" and play again from the top.
    const seekTo =
      pendingResume.durationSec && pendingResume.positionSec > pendingResume.durationSec - 5
        ? 0
        : pendingResume.positionSec

    openPlayer(session.sessionId, index, {
      resumePositionSec: seekTo,
      title: pendingResume.title
    })
    setPendingResume(null)
  }, [session, pendingResume, openPlayer])

  return { session, error, start, reset, pickFile, stopTorrent, setPaused, resumeFromLibrary }
}
