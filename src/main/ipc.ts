import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import type {
  AppSettings,
  DownloadsSummary,
  LibraryEntry,
  MediaMetadata,
  PlaybackProgress,
  ProviderHealth,
  YouTubeVideo,
  StreamTarget,
  TorrentFile,
  TorrentResult,
  SearchSuggestion,
  AudioTrackInfo
} from '../shared/types.ts'
import {
  IPC,
  type AddTorrentRequest,
  type DiscoverRequest,
  type SearchRequest,
  type SearchResponse,
  type StreamRequest,
  type TorrentStatus
} from '../shared/ipc.ts'
import { engineManager } from './engine/manager.ts'
import { localFiles } from './engine/local.ts'
import { downloads } from './downloads.ts'
import { appendTrackers, infoHashFromTorrent } from './engine/magnet.ts'
import { BROWSER_PLAYABLE_EXTENSIONS, type EngineSession } from './engine/types.ts'
import { library } from './library.ts'
import { fetchDiscover, fetchMetadata, fetchSuggestions } from './metadata/tmdb.ts'
import { httpBuffer } from './net/http.ts'
import { runDiagnostics } from './diagnostics.ts'
import { checkProviderHealth, searchAll } from './providers/registry.ts'
import { settings } from './settings.ts'
import { StreamServer } from './stream/server.ts'
import { probeAudioTracks } from './stream/probe.ts'
import { searchTrailers } from './youtube/youtube.ts'

let streamServer: StreamServer | null = null

export function getStreamServer(): StreamServer {
  if (!streamServer) {
    // A live engine owns streaming for active sessions; the local file
    // engine is the fallback for completed downloads and disk imports.
    streamServer = new StreamServer(
      (sessionId) =>
        engineManager.engineFor(sessionId) ??
        (localFiles.get(sessionId) ? localFiles : undefined)
    )
  }
  return streamServer
}

function downloadsSummary(): DownloadsSummary {
  // The same torrent can be known to both engines after switching; count it once.
  const seen = new Set<string>()
  const sessions = engineManager.list.flatMap((engine) => engine.list()).filter((session) => {
    const key = session.infoHash ?? session.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const paused = sessions.filter((session) => session.paused)
  const active = sessions.filter((session) => !session.paused && session.state !== 'complete')
  const speed = active.reduce((sum, session) => sum + session.downloadSpeed, 0)
  return { activeCount: active.length, pausedCount: paused.length, totalDownloadSpeed: speed }
}

/** Validate a renderer-supplied file index against an array of files. */
function fileAt<T>(files: T[] | undefined, index: unknown): T | undefined {
  if (!files) return undefined
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= files.length) {
    return undefined
  }
  return files[index]
}

function toTorrentStatus(session: EngineSession): TorrentStatus {
  return {
    sessionId: session.id,
    infoHash: session.infoHash,
    name: session.name,
    progress: session.progress,
    downloadSpeed: session.downloadSpeed,
    uploadSpeed: session.uploadSpeed,
    numPeers: session.numPeers,
    state: session.state,
    paused: session.paused,
    error: session.error,
    files: session.files.map((file) => ({
      index: file.index,
      name: file.name,
      size: file.size,
      ext: file.ext,
      isVideo: file.isVideo,
      isSubtitle: file.isSubtitle
    }))
  }
}

/** Validates an `audio` ordinal from any caller; rejects non-integers. */
function parseAudioTrack(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 31) {
    throw new Error('Invalid audio track index')
  }
  return value
}

function decidePlayback(
  file: { ext: string },
  forceTranscode: boolean,
  audioTrack?: number
): { mode: 'direct' | 'hls'; needsTranscode: boolean; reason?: string } {
  // The browser cannot pick among embedded audio tracks, so an explicit
  // selection has to go through the transcode with that stream mapped.
  if (audioTrack !== undefined) {
    return { mode: 'hls', needsTranscode: true, reason: 'Audio track selection' }
  }
  if (forceTranscode) {
    return { mode: 'hls', needsTranscode: true, reason: 'Transcode requested' }
  }
  if (BROWSER_PLAYABLE_EXTENSIONS.has(file.ext)) {
    return { mode: 'direct', needsTranscode: false }
  }
  return {
    mode: 'hls',
    needsTranscode: true,
    reason: `${file.ext.toUpperCase() || 'Unknown'} containers are not playable in the browser`
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const server = getStreamServer()

  ipcMain.handle(IPC.search, async (_event, request: SearchRequest): Promise<SearchResponse> => {
    const current = settings.get()
    const started = Date.now()
    const aggregated = await searchAll(request.query, request.filters, {
      trackers: current.trackers,
      proxy: current.proxy.enabled ? current.proxy : undefined
    })

    // The provider's own category filter is only a hint. Raw results go back to
    // the renderer so changing a filter chip never needs a new network call.
    const results: TorrentResult[] = aggregated.results

    return {
      results,
      providers: aggregated.health,
      elapsedMs: Date.now() - started
    }
  })

  ipcMain.handle(IPC.searchSuggest, async (_event, query: string): Promise<SearchSuggestion[]> => {
    if (typeof query !== 'string') return []
    const current = settings.get()
    const proxy = current.proxy.enabled ? current.proxy : undefined
    return fetchSuggestions(query, proxy)
  })

  ipcMain.handle(IPC.discover, async (_event, request: DiscoverRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Invalid discover request')
    if (request.kind !== 'movie' && request.kind !== 'tv') throw new Error('Invalid discover kind')
    if (request.genreId !== undefined && request.genreId !== null && !Number.isInteger(request.genreId)) {
      throw new Error('Invalid genre id')
    }
    if (request.year !== undefined && request.year !== null && !Number.isInteger(request.year)) {
      throw new Error('Invalid year')
    }
    if (
      request.minRating !== undefined &&
      request.minRating !== null &&
      (typeof request.minRating !== 'number' || !Number.isFinite(request.minRating))
    ) {
      throw new Error('Invalid minimum rating')
    }
    if (
      request.page !== undefined &&
      (!Number.isInteger(request.page) || request.page < 1 || request.page > 100)
    ) {
      throw new Error('Invalid page')
    }
    const current = settings.get()
    return fetchDiscover(request, current.proxy.enabled ? current.proxy : undefined)
  })

  ipcMain.handle(IPC.providersHealth, async (): Promise<ProviderHealth[]> => {
    return checkProviderHealth()
  })

  ipcMain.handle(
    IPC.youtubeTrailers,
    async (_event, title: string, year?: number): Promise<YouTubeVideo[]> => {
      return searchTrailers(title, year)
    }
  )

  ipcMain.handle(
    IPC.metadata,
    async (_event, title: string, year?: number, imdbId?: string): Promise<MediaMetadata | null> => {
      const current = settings.get()
      const proxy = current.proxy.enabled ? current.proxy : undefined
      return fetchMetadata(title, year, imdbId, proxy)
    }
  )

  ipcMain.handle(
    IPC.torrentAdd,
    async (_event, request: AddTorrentRequest): Promise<TorrentStatus> => {
      if (!request || typeof request !== 'object') throw new Error('Invalid add request')
      if (request.magnet !== undefined && typeof request.magnet !== 'string') {
        throw new Error('magnet must be a string')
      }
      if (request.url !== undefined && typeof request.url !== 'string') {
        throw new Error('url must be a string')
      }
      if (request.title !== undefined && typeof request.title !== 'string') {
        throw new Error('title must be a string')
      }
      if (
        request.infoHash !== undefined &&
        (typeof request.infoHash !== 'string' || !/^[0-9a-fA-F]{40}$|^[a-z2-7]{32}$/.test(request.infoHash))
      ) {
        throw new Error('infoHash must be a 40-char hex or 32-char base32 hash')
      }
      if (!request.magnet && !request.url) throw new Error('A magnet link or .torrent URL is required')
      const current = settings.get()
      const magnet = request.magnet ? appendTrackers(request.magnet, current.trackers) : undefined
      const session = await engineManager.add({
        magnet,
        url: request.url,
        title: request.title,
        infoHash: request.infoHash
      })
      // The downloads pill usually updates on engine ticks; push it now so a
      // brand-new torrent shows up immediately.
      getWindow()?.webContents.send('ptm:downloads-summary', downloadsSummary())
      // Track it in the download library — completion is detected in onUpdate.
      downloads.trackAdd({
        magnet,
        infoHash: request.infoHash,
        title: request.title ?? session.name,
        sessionId: session.id
      })
      return toTorrentStatus(session)
    }
  )

  ipcMain.handle(IPC.resolveMagnet, async (_event, url: string): Promise<string | null> => {
    const current = settings.get()
    const proxy = current.proxy.enabled ? current.proxy : undefined
    try {
      if (/^magnet:/i.test(url)) return appendTrackers(url, current.trackers)

      const response = await httpBuffer(url, { proxy, timeout: 20000, maxBytes: 16 * 1024 * 1024 })
      if (response.status < 200 || response.status >= 300) return null

      // A binary .torrent response carries the info hash; checking it first
      // avoids utf8-decoding megabytes of binary.
      const infoHash = infoHashFromTorrent(response.body)
      if (infoHash) {
        return appendTrackers(`magnet:?xt=urn:btih:${infoHash}`, current.trackers)
      }

      // Some tracker pages embed the magnet directly in HTML.
      const text = response.body.toString('utf8').replace(/&amp;/g, '&')
      const match = text.match(/magnet:\?xt=urn:btih:[A-Za-z0-9]+[^"'\s<]*/i)
      if (match) return appendTrackers(match[0], current.trackers)
      return null
    } catch (error) {
      console.warn('[ipc] magnet resolve failed', (error as Error).message)
      return null
    }
  })

  ipcMain.handle(
    IPC.torrentFiles,
    async (_event, sessionId: string): Promise<TorrentFile[]> => {
      const session = engineManager.get(sessionId)
      return (
        session?.files.map((file) => ({
          index: file.index,
          name: file.name,
          size: file.size,
          ext: file.ext,
          isVideo: file.isVideo,
          isSubtitle: file.isSubtitle
        })) ?? []
      )
    }
  )

  ipcMain.handle(IPC.torrentRemove, async (_event, sessionId: string): Promise<void> => {
    server.stopHls(sessionId)
    const session = engineManager.get(sessionId)
    await engineManager.remove(sessionId)
    if (session) downloads.markStopped(session)
    getWindow()?.webContents.send('ptm:downloads-summary', downloadsSummary())
  })

  ipcMain.handle(
    IPC.torrentSetPaused,
    async (_event, sessionId: string, paused: boolean) => {
      const session = await engineManager.setPaused(sessionId, paused)
      getWindow()?.webContents.send('ptm:downloads-summary', downloadsSummary())
      return session ? toTorrentStatus(session) : undefined
    }
  )

  ipcMain.handle(IPC.downloadsSummary, async () => downloadsSummary())

  /** Find a live engine session by either its UUID or its info hash. */
  const findSessionByDownloadId = (id: string) => {
    const lower = id.toLowerCase()
    for (const engine of engineManager.list) {
      for (const session of engine.list()) {
        if (session.id === id || session.infoHash?.toLowerCase() === lower) return session
      }
    }
    return undefined
  }

  ipcMain.handle(IPC.downloadsList, async () => downloads.list())

  ipcMain.handle(IPC.downloadsGet, async (_event, id: string) => {
    if (typeof id !== 'string' || !id) return null
    return downloads.get(id) ?? null
  })

  ipcMain.handle(IPC.downloadsScan, async () => {
    // Never import paths that a live engine session is still writing.
    const claimed = new Set(
      engineManager.list
        .flatMap((engine) => engine.list())
        .flatMap((session) => session.files.map((file) => file.path.toLowerCase()))
    )
    return downloads.scan(claimed)
  })

  ipcMain.handle(
    IPC.downloadsRemove,
    async (_event, id: string, deleteFiles: boolean) => {
      if (typeof id !== 'string' || !id) return { deleted: 0, failed: [] }
      // Deleting an in-flight download means stopping it first.
      const live = findSessionByDownloadId(id)
      if (live) {
        server.stopHls(live.id)
        await engineManager.remove(live.id)
      }
      // Disk-streamed playback keys HLS sessions by the downloads id —
      // always stop those too, or ffmpeg and the temp dir leak.
      server.stopHls(id)
      const result = await downloads.remove(id, Boolean(deleteFiles))
      getWindow()?.webContents.send('ptm:downloads-summary', downloadsSummary())
      return result
    }
  )

  ipcMain.handle(IPC.downloadsReveal, async (_event, id: string) => {
    if (typeof id !== 'string' || !id) return false
    return downloads.reveal(id)
  })

  ipcMain.handle(IPC.torrentStatus, async (_event, sessionId: string) => {
    const session = engineManager.get(sessionId)
    return session ? toTorrentStatus(session) : null
  })

  ipcMain.handle(
    IPC.streamStart,
    async (_event, request: StreamRequest): Promise<StreamTarget> => {
      // Active sessions stream from the engine; completed downloads and disk
      // imports stream from disk through the local file engine.
      if (!request || typeof request.sessionId !== 'string') {
        throw new Error('Invalid stream request')
      }
      const audioTrack = parseAudioTrack(request.audioTrack)
      const engineSession = engineManager.get(request.sessionId)
      const item = engineSession ? undefined : downloads.get(request.sessionId)
      if (!engineSession && item && item.status !== 'complete') {
        throw new Error('Download is not complete yet')
      }
      const file = fileAt(engineSession?.files, request.fileIndex) ?? fileAt(item?.files, request.fileIndex)
      if (!file) throw new Error('Unknown torrent session')

      const decision = decidePlayback(file, Boolean(request.forceTranscode), audioTrack)

      return {
        sessionId: request.sessionId,
        fileIndex: request.fileIndex,
        url:
          decision.mode === 'direct'
            ? server.directUrl(request.sessionId, request.fileIndex)
            : server.hlsUrl(
                request.sessionId,
                request.fileIndex,
                audioTrack,
                Boolean(request.forceTranscode)
              ),
        mode: decision.mode,
        mimeType: decision.mode === 'direct' ? `video/${file.ext}` : 'application/vnd.apple.mpegurl',
        contentLength: file.size,
        supportsRange: decision.mode === 'direct',
        needsTranscode: decision.needsTranscode,
        reason: decision.reason
      }
    }
  )

  ipcMain.handle(IPC.streamStop, async (_event, sessionId: string): Promise<void> => {
    server.stopHls(sessionId)
  })

  ipcMain.handle(
    IPC.audioTracks,
    async (_event, sessionId: string, fileIndex: number): Promise<AudioTrackInfo[]> => {
      const engineSession = engineManager.get(sessionId)
      const item = engineSession ? undefined : downloads.get(sessionId)
      const file = fileAt(engineSession?.files, fileIndex) ?? fileAt(item?.files, fileIndex)
      if (!file) return []
      // Probing reads the header through the same byte-range path the player
      // uses; a slow torrent just yields an empty list (ffmpeg times out).
      return probeAudioTracks(server.directUrl(sessionId, fileIndex))
    }
  )

  ipcMain.handle(
    IPC.subtitleUrl,
    async (_event, sessionId: string, fileIndex: number): Promise<string | null> => {
      const session = engineManager.get(sessionId)
      const item = session ? undefined : downloads.get(sessionId)
      const file = fileAt(session?.files, fileIndex) ?? fileAt(item?.files, fileIndex)
      if (!file || !file.isSubtitle || (file.ext !== 'srt' && file.ext !== 'vtt')) return null
      return server.subtitleUrl(sessionId, fileIndex)
    }
  )

  ipcMain.handle(IPC.settingsGet, async (): Promise<AppSettings> => settings.get())

  ipcMain.handle(
    IPC.settingsSet,
    async (_event, next: Partial<AppSettings>): Promise<AppSettings> => {
      if (!next || typeof next !== 'object') throw new Error('Invalid settings payload')
      if (next.trackers !== undefined) {
        if (!Array.isArray(next.trackers) || !next.trackers.every((t) => typeof t === 'string')) {
          throw new Error('trackers must be an array of strings')
        }
      }
      if (next.downloadDir !== undefined && typeof next.downloadDir !== 'string') {
        throw new Error('downloadDir must be a string')
      }
      if (next.tmdbApiKey !== undefined && typeof next.tmdbApiKey !== 'string') {
        throw new Error('tmdbApiKey must be a string')
      }
      if (next.proxy !== undefined) {
        // Partial patches are deep-merged onto the current proxy, so validate
        // whatever fields are present rather than requiring the full object.
        if (typeof next.proxy !== 'object' || next.proxy === null) {
          throw new Error('Invalid proxy config')
        }
        const p = next.proxy
        if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw new Error('Invalid proxy.enabled')
        if (p.type !== undefined && typeof p.type !== 'string') throw new Error('Invalid proxy.type')
        if (p.host !== undefined && typeof p.host !== 'string') throw new Error('Invalid proxy.host')
        if (p.port !== undefined && (typeof p.port !== 'number' || !Number.isFinite(p.port))) {
          throw new Error('Invalid proxy.port')
        }
      }
      if (
        next.preferredAudioLanguage !== undefined &&
        typeof next.preferredAudioLanguage !== 'string'
      ) {
        throw new Error('preferredAudioLanguage must be a string')
      }
      // Partial patches merge onto the current settings — callers can send
      // just the keys they changed without clobbering concurrent edits with
      // a stale snapshot.
      return settings.set(next)
    }
  )

  ipcMain.handle(IPC.pickDirectory, async (_event, defaultPath?: string): Promise<string | null> => {
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      ...(defaultPath ? { defaultPath } : {})
    }
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.defaultDownloads, async (): Promise<string> => {
    try {
      return app.getPath('downloads')
    } catch {
      return path.join(app.getPath('userData'), 'torrents')
    }
  })

  ipcMain.handle(IPC.libraryList, async (): Promise<LibraryEntry[]> => library.list())

  ipcMain.handle(
    IPC.librarySaveProgress,
    async (_event, progress: PlaybackProgress): Promise<void> => {
      if (!progress || typeof progress !== 'object') throw new Error('Invalid progress payload')
      if (typeof progress.infoHash !== 'string' || !progress.infoHash) {
        throw new Error('progress.infoHash must be a non-empty string')
      }
      if (typeof progress.fileIndex !== 'number' || !Number.isFinite(progress.fileIndex)) {
        throw new Error('progress.fileIndex must be a number')
      }
      if (typeof progress.positionSec !== 'number' || !Number.isFinite(progress.positionSec) || progress.positionSec < 0) {
        throw new Error('progress.positionSec must be a non-negative finite number')
      }
      if (progress.durationSec !== undefined && (typeof progress.durationSec !== 'number' || !Number.isFinite(progress.durationSec))) {
        throw new Error('progress.durationSec must be a finite number')
      }
      library.saveProgress(progress)
    }
  )

  ipcMain.handle(IPC.libraryRemove, async (_event, infoHash: string): Promise<void> => {
    library.remove(infoHash)
  })

  ipcMain.handle(IPC.diagnostics, async () => runDiagnostics())

  ipcMain.handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  // Push engine updates to the renderer.
  engineManager.onUpdate((session) => {
    const window = getWindow()
    try {
      const tracked = downloads.trackProgress(session)
      if (tracked?.justCompleted) {
        if (window) window.webContents.send('ptm:download-complete', tracked.item)
      }
    } catch (error) {
      // A throw here would otherwise propagate into the engine's emit loop and
      // silence every later update for this session.
      console.error('[downloads] trackProgress failed', (error as Error).message)
    }
    if (!window) return
    window.webContents.send('ptm:torrent-status', toTorrentStatus(session))
    window.webContents.send('ptm:downloads-summary', downloadsSummary())
  })
}
