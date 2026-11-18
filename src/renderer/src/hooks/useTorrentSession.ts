import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { TorrentStatus } from '../../../shared/ipc.ts'
import type { LibraryEntry, Theme, TorrentResult } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

export function useTorrentSession() {
  const [session, setSession] = useState<TorrentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingResume, setPendingResume] = useState<LibraryEntry | null>(null)
  const activeSessionId = useRef<string | null>(null)
  const generation = useRef(0)
  const openPlayer = useUiStore((state) => state.openPlayer)

  useEffect(() => {
    return api.onTorrentStatus((status) => {
      // No tracked session → drop the event; otherwise one unrelated engine
      // update would resurrect a ghost panel.
      if (!activeSessionId.current || status.sessionId !== activeSessionId.current) return
      setSession(status)
    })
  }, [])

  /** Build a magnet (or fall back to the provider URL) for a result. */
  const resolveSource = useCallback(async (result: TorrentResult) => {
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
    return { magnet, url: magnet ? undefined : result.url }
  }, [])

  const start = useCallback(async (result: TorrentResult) => {
    generation.current += 1
    setError(null)
    setPendingResume(null)
    try {
      const { magnet, url } = await resolveSource(result)
      const status = await api.torrentAdd({
        magnet,
        url,
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
  }, [resolveSource])

  /** Add the torrent to the downloads without opening the player. */
  const download = useCallback(
    async (result: TorrentResult) => {
      generation.current += 1
      try {
        const { magnet, url } = await resolveSource(result)
        await api.torrentAdd({
          magnet,
          url,
          title: result.name,
          infoHash: result.infoHash
        })
        toast.success('Added to downloads')
      } catch (err) {
        const message = (err as Error).message
        setError(message)
        toast.error(`Could not start download: ${message}`)
        throw err
      }
    },
    [resolveSource]
  )

  const pickFile = useCallback(
    (sessionId: string, fileIndex: number, opts?: { resumePositionSec?: number; title?: string; theme?: Theme; imdbId?: string }) => {
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
      try {
        const status = await api.torrentSetPaused(id, paused)
        if (status) setSession(status)
      } catch (err) {
        toast.error(`Could not ${paused ? 'pause' : 'resume'}: ${(err as Error).message}`)
      }
    },
    []
  )

  const reset = useCallback(() => {
    generation.current += 1
    setSession(null)
    setError(null)
    setPendingResume(null)
    activeSessionId.current = null
  }, [])

  /**
   * Re-add a torrent that was being watched, using the info hash we stored,
   * and seek to the saved position once metadata arrives. Disk-imported
   * entries (id `file:…`) play straight from disk instead.
   */
  const resumeFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      reset()
      const gen = generation.current
      setPendingResume(entry)

      if (entry.infoHash.startsWith('file:')) {
        const seekTo =
          entry.durationSec && entry.positionSec > entry.durationSec - 5 ? 0 : entry.positionSec
        openPlayer(entry.infoHash, 0, {
          resumePositionSec: seekTo,
          title: entry.title,
          theme: entry.theme,
          imdbId: entry.imdbId
        })
        setPendingResume(null)
        return
      }

      // If the download is already complete on disk, play the file directly
      // instead of re-adding the torrent to the swarm.
      try {
        const list = await api.downloadsList()
        if (generation.current !== gen) return
        const local = list.find((item) => item.id === entry.infoHash && item.status === 'complete')
        if (local) {
          const target = Math.min(entry.fileIndex, local.files.length - 1)
          const seekTo =
            entry.durationSec && entry.positionSec > entry.durationSec - 5
              ? 0
              : entry.positionSec
          openPlayer(local.id, target, {
            resumePositionSec: seekTo,
            title: entry.title,
            theme: entry.theme,
            imdbId: entry.imdbId
          })
          setPendingResume(null)
          return
        }
      } catch {
        // Fall through to re-adding the torrent.
      }

      const magnet = `magnet:?xt=urn:btih:${entry.infoHash}&dn=${encodeURIComponent(entry.name)}`
      try {
        const status = await api.torrentAdd({
          magnet,
          title: entry.name,
          infoHash: entry.infoHash
        })
        if (generation.current !== gen) {
          // Superseded by a user action while the add was in flight — leave
          // that session alone; the torrent itself was still registered.
          setPendingResume(null)
          return
        }
        activeSessionId.current = status.sessionId
        setSession(status)
      } catch (err) {
        const message = (err as Error).message
        setPendingResume(null)
        setError(message)
        toast.error(`Could not resume: ${message}`)
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
      title: pendingResume.title,
      theme: pendingResume.theme,
      imdbId: pendingResume.imdbId
    })
    setPendingResume(null)
  }, [session, pendingResume, openPlayer])

  return { session, error, start, download, reset, pickFile, stopTorrent, setPaused, resumeFromLibrary }
}
