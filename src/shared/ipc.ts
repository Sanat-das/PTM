import type {
  AppSettings,
  DiagnosticResult,
  DownloadsSummary,
  LibraryEntry,
  MediaMetadata,
  PlaybackProgress,
  ProviderHealth,
  YouTubeVideo,
  SearchFilters,
  StreamTarget,
  TorrentFile,
  TorrentResult
} from './types.ts'

export const IPC = {
  search: 'ptm:search',
  providersHealth: 'ptm:providers-health',
  youtubeTrailers: 'ptm:youtube-trailers',
  metadata: 'ptm:metadata',
  torrentAdd: 'ptm:torrent-add',
  resolveMagnet: 'ptm:resolve-magnet',
  torrentFiles: 'ptm:torrent-files',
  torrentRemove: 'ptm:torrent-remove',
  torrentStatus: 'ptm:torrent-status',
  streamStart: 'ptm:stream-start',
  streamStop: 'ptm:stream-stop',
  subtitleUrl: 'ptm:subtitle-url',
  settingsGet: 'ptm:settings-get',
  settingsSet: 'ptm:settings-set',
  pickDirectory: 'ptm:pick-directory',
  defaultDownloads: 'ptm:default-downloads',
  libraryList: 'ptm:library-list',
  librarySaveProgress: 'ptm:library-save-progress',
  libraryRemove: 'ptm:library-remove',
  diagnostics: 'ptm:diagnostics',
  openExternal: 'ptm:open-external',
  torrentSetPaused: 'ptm:torrent-set-paused',
  downloadsSummary: 'ptm:downloads-summary'
} as const

export interface SearchRequest {
  query: string
  filters: SearchFilters
}

export interface SearchResponse {
  results: TorrentResult[]
  providers: ProviderHealth[]
  elapsedMs: number
}

export interface AddTorrentRequest {
  magnet?: string
  url?: string
  title?: string
  infoHash?: string
}

export interface TorrentStatus {
  sessionId: string
  infoHash?: string
  name?: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  state: string
  paused: boolean
  error?: string
  files: TorrentFile[]
}

export interface StreamRequest {
  sessionId: string
  fileIndex: number
  forceTranscode?: boolean
}

export interface PtmApi {
  search(request: SearchRequest): Promise<SearchResponse>
  providersHealth(): Promise<ProviderHealth[]>
  youtubeTrailers(title: string, year?: number): Promise<YouTubeVideo[]>
  metadata(title: string, year?: number, imdbId?: string): Promise<MediaMetadata | null>
  torrentAdd(request: AddTorrentRequest): Promise<TorrentStatus>
  resolveMagnet(url: string): Promise<string | null>
  torrentFiles(sessionId: string): Promise<TorrentFile[]>
  torrentRemove(sessionId: string): Promise<void>
  torrentStatus(sessionId: string): Promise<TorrentStatus | null>
  streamStart(request: StreamRequest): Promise<StreamTarget>
  streamStop(sessionId: string): Promise<void>
  /** WebVTT URL for a subtitle file, or null when it cannot be served. */
  subtitleUrl(sessionId: string, fileIndex: number): Promise<string | null>
  settingsGet(): Promise<AppSettings>
  settingsSet(settings: Partial<AppSettings>): Promise<AppSettings>
  pickDirectory(defaultPath?: string): Promise<string | null>
  defaultDownloads(): Promise<string>
  libraryList(): Promise<LibraryEntry[]>
  librarySaveProgress(progress: PlaybackProgress): Promise<void>
  libraryRemove(infoHash: string): Promise<void>
  diagnostics(): Promise<DiagnosticResult[]>
  openExternal(url: string): Promise<void>
  torrentSetPaused(sessionId: string, paused: boolean): Promise<TorrentStatus | undefined>
  downloadsSummary(): Promise<DownloadsSummary>
  onTorrentStatus(cb: (status: TorrentStatus) => void): () => void
  onDownloadsSummary(cb: (summary: DownloadsSummary) => void): () => void
}
