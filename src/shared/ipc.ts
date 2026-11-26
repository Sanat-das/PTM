import type {
  AppSettings,
  AudioTrackInfo,
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
  TorrentResult,
  SearchSuggestion,
  DownloadItem,
  DiscoverItem,
  DiscoverKind,
  DiscoverSort
} from './types.ts'

export const IPC = {
  search: 'ptm:search',
  searchSuggest: 'ptm:search-suggest',
  discover: 'ptm:discover',
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
  audioTracks: 'ptm:audio-tracks',
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
  downloadsSummary: 'ptm:downloads-summary',
  downloadsList: 'ptm:downloads-list',
  downloadsGet: 'ptm:downloads-get',
  downloadsScan: 'ptm:downloads-scan',
  downloadsRemove: 'ptm:downloads-remove',
  downloadsReveal: 'ptm:downloads-reveal'
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

export interface DiscoverRequest {
  kind: DiscoverKind
  genreId?: number | null
  year?: number | null
  minRating?: number | null
  sort: DiscoverSort
  /** 1-based TMDB page; each page holds up to 20 titles. */
  page?: number
}

export interface DiscoverResponse {
  items: DiscoverItem[]
  /** False when no TMDB API key is configured (Discover is optional). */
  configured: boolean
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
  /** 0-based audio stream ordinal to select; forces the transcode path. */
  audioTrack?: number
}

export interface PtmApi {
  search(request: SearchRequest): Promise<SearchResponse>
  searchSuggest(query: string): Promise<SearchSuggestion[]>
  discover(request: DiscoverRequest): Promise<DiscoverResponse>
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
  /** Audio streams in a media file, best-effort; empty when probing fails. */
  audioTracks(sessionId: string, fileIndex: number): Promise<AudioTrackInfo[]>
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
  /** All tracked downloads (active, complete, missing), sorted for display. */
  downloadsList(): Promise<DownloadItem[]>
  downloadsGet(id: string): Promise<DownloadItem | null>
  /** Scan the configured download folder for video files not already tracked. */
  downloadsScan(): Promise<{ added: number; skipped: number }>
  /** Remove an item from the library; optionally delete the video/subtitle files from disk. */
  downloadsRemove(
    id: string,
    deleteFiles: boolean
  ): Promise<{ deleted: number; failed: string[] }>
  /** Reveal the primary video file in the OS file manager. */
  downloadsReveal(id: string): Promise<boolean>
  onDownloadComplete(cb: (item: DownloadItem) => void): () => void
  onTorrentStatus(cb: (status: TorrentStatus) => void): () => void
  onDownloadsSummary(cb: (summary: DownloadsSummary) => void): () => void
}
