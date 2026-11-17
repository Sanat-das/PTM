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
  TorrentResult
} from '../shared/types.ts'
import {
  IPC,
  type AddTorrentRequest,
  type SearchRequest,
  type SearchResponse,
  type StreamRequest,
  type TorrentStatus
} from '../shared/ipc.ts'
import { engineManager } from './engine/manager.ts'
import { appendTrackers, infoHashFromTorrent } from './engine/magnet.ts'
import { BROWSER_PLAYABLE_EXTENSIONS, type EngineFile, type EngineSession } from './engine/types.ts'
import { library } from './library.ts'
import { fetchMetadata } from './metadata/tmdb.ts'
import { httpBuffer } from './net/http.ts'
import { runDiagnostics } from './diagnostics.ts'
import { checkProviderHealth, searchAll } from './providers/registry.ts'
import { settings } from './settings.ts'
import { StreamServer } from './stream/server.ts'
import { searchTrailers } from './youtube/youtube.ts'

let streamServer: StreamServer | null = null

export function getStreamServer(): StreamServer {
  if (!streamServer) {
    streamServer = new StreamServer((sessionId) => engineManager.engineFor(sessionId))
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

function decidePlayback(
  file: EngineFile,
  forceTranscode: boolean
): { mode: 'direct' | 'hls'; needsTranscode: boolean; reason?: string } {
  if (forceTranscode) {
    return { mode: 'hls', needsTranscode: true, reason: 'Transcode requested' }
  }
  if (BROWSER_PLAYABLE_EXTENSIONS.has(file.ext)) {
    if (file.ext === 'mov') {
      return { mode: 'hls', needsTranscode: true, reason: 'QuickTime container' }
    }
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
      return fetchMetadata(title, year, imdbId)
    }
  )

  ipcMain.handle(
    IPC.torrentAdd,
    async (_event, request: AddTorrentRequest): Promise<TorrentStatus> => {
      const current = settings.get()
      const magnet = request.magnet ? appendTrackers(request.magnet, current.trackers) : undefined
      const session = await engineManager.add({
        magnet,
        url: request.url,
        title: request.title,
        infoHash: request.infoHash
      })
      return toTorrentStatus(session)
    }
  )

  ipcMain.handle(IPC.resolveMagnet, async (_event, url: string): Promise<string | null> => {
    const current = settings.get()
    const proxy = current.proxy.enabled ? current.proxy : undefined
    try {
      if (/^magnet:/i.test(url)) return appendTrackers(url, current.trackers)

      const response = await httpBuffer(url, { proxy, timeout: 20000 })
      if (response.status < 200 || response.status >= 300) return null

      // Some trackers' pages embed the magnet directly.
      const text = response.body.toString('utf8').replace(/&amp;/g, '&')
      const match = text.match(/magnet:\?xt=urn:btih:[A-Za-z0-9]+[^"'\s<]*/i)
      if (match) return appendTrackers(match[0], current.trackers)

      // Others serve the .torrent itself, which carries the info hash.
      const infoHash = infoHashFromTorrent(response.body)
      if (infoHash) {
        return appendTrackers(`magnet:?xt=urn:btih:${infoHash}`, current.trackers)
      }
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
    await engineManager.remove(sessionId)
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

  ipcMain.handle(IPC.torrentStatus, async (_event, sessionId: string) => {
    const session = engineManager.get(sessionId)
    return session ? toTorrentStatus(session) : null
  })

  ipcMain.handle(
    IPC.streamStart,
    async (_event, request: StreamRequest): Promise<StreamTarget> => {
      const session = engineManager.get(request.sessionId)
      if (!session) throw new Error('Unknown torrent session')
      const file = session.files[request.fileIndex]
      if (!file) throw new Error('Unknown file index')

      const decision = decidePlayback(file, Boolean(request.forceTranscode))

      return {
        sessionId: request.sessionId,
        fileIndex: request.fileIndex,
        url:
          decision.mode === 'direct'
            ? server.directUrl(request.sessionId, request.fileIndex)
            : server.hlsUrl(request.sessionId, request.fileIndex),
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
    IPC.subtitleUrl,
    async (_event, sessionId: string, fileIndex: number): Promise<string | null> => {
      const session = engineManager.get(sessionId)
      const file = session?.files[fileIndex]
      if (!file || !file.isSubtitle || (file.ext !== 'srt' && file.ext !== 'vtt')) return null
      return server.subtitleUrl(sessionId, fileIndex)
    }
  )

  ipcMain.handle(IPC.settingsGet, async (): Promise<AppSettings> => settings.get())

  ipcMain.handle(IPC.settingsSet, async (_event, next: AppSettings): Promise<AppSettings> => {
    const saved = settings.set(next)
    engineManager.use(saved.engine)
    const window = getWindow()
    window?.webContents.send('ptm:settings-changed', saved)
    return saved
  })

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
    if (!window) return
    window.webContents.send('ptm:torrent-status', toTorrentStatus(session))
    window.webContents.send('ptm:downloads-summary', downloadsSummary())
  })
}
