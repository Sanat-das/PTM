import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AddTorrentRequest,
  type PtmApi,
  type SearchRequest,
  type StreamRequest,
  type TorrentStatus
} from '../shared/ipc.ts'
import type {
  AppSettings,
  DownloadsSummary,
  LibraryEntry,
  MediaMetadata,
  PlaybackProgress,
  ProviderHealth,
  YouTubeVideo,
  StreamTarget,
  TorrentFile
} from '../shared/types.ts'

const api: PtmApi = {
  search: (request: SearchRequest) => ipcRenderer.invoke(IPC.search, request),
  providersHealth: () => ipcRenderer.invoke(IPC.providersHealth),
  youtubeTrailers: (title: string, year?: number) =>
    ipcRenderer.invoke(IPC.youtubeTrailers, title, year),
  metadata: (title: string, year?: number, imdbId?: string) =>
    ipcRenderer.invoke(IPC.metadata, title, year, imdbId),
  torrentAdd: (request: AddTorrentRequest) => ipcRenderer.invoke(IPC.torrentAdd, request),
  resolveMagnet: (url: string) => ipcRenderer.invoke(IPC.resolveMagnet, url),
  torrentFiles: (sessionId: string) => ipcRenderer.invoke(IPC.torrentFiles, sessionId),
  torrentRemove: (sessionId: string) => ipcRenderer.invoke(IPC.torrentRemove, sessionId),
  torrentStatus: (sessionId: string) => ipcRenderer.invoke(IPC.torrentStatus, sessionId),
  streamStart: (request: StreamRequest) => ipcRenderer.invoke(IPC.streamStart, request),
  streamStop: (sessionId: string) => ipcRenderer.invoke(IPC.streamStop, sessionId),
  subtitleUrl: (sessionId: string, fileIndex: number) =>
    ipcRenderer.invoke(IPC.subtitleUrl, sessionId, fileIndex),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSet, settings),
  pickDirectory: (defaultPath?: string) => ipcRenderer.invoke(IPC.pickDirectory, defaultPath),
  defaultDownloads: () => ipcRenderer.invoke(IPC.defaultDownloads),
  libraryList: () => ipcRenderer.invoke(IPC.libraryList),
  librarySaveProgress: (progress: PlaybackProgress) =>
    ipcRenderer.invoke(IPC.librarySaveProgress, progress),
  libraryRemove: (infoHash: string) => ipcRenderer.invoke(IPC.libraryRemove, infoHash),
  diagnostics: () => ipcRenderer.invoke(IPC.diagnostics),
  torrentSetPaused: (sessionId: string, paused: boolean) =>
    ipcRenderer.invoke(IPC.torrentSetPaused, sessionId, paused),
  downloadsSummary: () => ipcRenderer.invoke(IPC.downloadsSummary),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  onTorrentStatus: (cb: (status: TorrentStatus) => void) => {
    const listener = (_event: unknown, status: TorrentStatus) => cb(status)
    ipcRenderer.on('ptm:torrent-status', listener)
    return () => ipcRenderer.removeListener('ptm:torrent-status', listener)
  },
  onDownloadsSummary: (cb: (summary: DownloadsSummary) => void) => {
    const listener = (_event: unknown, summary: DownloadsSummary) => cb(summary)
    ipcRenderer.on('ptm:downloads-summary', listener)
    return () => ipcRenderer.removeListener('ptm:downloads-summary', listener)
  }
}

contextBridge.exposeInMainWorld('ptm', api)

export type { PtmApi, YouTubeVideo, ProviderHealth, MediaMetadata, StreamTarget, TorrentFile, LibraryEntry }
