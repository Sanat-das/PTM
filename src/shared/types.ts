/** Shared contract between the Electron main process and the renderer. */

export type Theme =
  | 'movies'
  | 'tv'
  | 'anime'
  | 'music'
  | 'games'
  | 'books'
  | 'apps'
  | 'adult'
  | 'other'

export type Resolution = '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'unknown'

export type Source =
  | 'BluRay'
  | 'REMUX'
  | 'BDRip'
  | 'BRRip'
  | 'WEB-DL'
  | 'WEBRip'
  | 'HDRip'
  | 'HDTV'
  | 'DVDRip'
  | 'CAM'
  | 'TS'
  | 'SATRip'
  | 'unknown'

export type Codec = 'x265' | 'x264' | 'AV1' | 'XviD' | 'DivX' | 'MPEG2' | 'unknown'

export interface ReleaseInfo {
  title: string
  year?: number
  resolution: Resolution
  source: Source
  codec: Codec
  audio?: string
  group?: string
  season?: number
  episode?: number
  is3d: boolean
  hdr: boolean
  proper: boolean
  repack: boolean
  isAnime: boolean
  edition?: string
}

export interface TorrentResult {
  /** Provider-scoped unique key. */
  id: string
  provider: string
  providerLabel: string
  name: string
  magnet?: string
  infoHash?: string
  size: number
  seeders: number
  leechers: number
  category: string
  theme: Theme
  imdbId?: string
  addedAt?: number
  url?: string
  fileCount?: number
  uploader?: string
  status?: string
  release: ReleaseInfo
}

export type SortKey = 'seeders' | 'size' | 'date' | 'name' | 'leechers'

export interface SearchFilters {
  themes: Theme[]
  resolutions: Resolution[]
  sources: Source[]
  codecs: Codec[]
  minSeeders: number
  maxSizeGb: number
  maxAgeDays: number
  sort: SortKey
  hideDead: boolean
  /** Provider-native category id used by Browse mode (e.g. a TPB cat id). */
  category?: string
}

export const DEFAULT_FILTERS: SearchFilters = {
  themes: [],
  resolutions: [],
  sources: [],
  codecs: [],
  minSeeders: 0,
  maxSizeGb: 0,
  maxAgeDays: 0,
  sort: 'seeders',
  hideDead: false,
  category: ''
}

export interface ProviderHealth {
  id: string
  name: string
  enabled: boolean
  reachable: boolean
  latencyMs?: number
  lastChecked?: number
  error?: string
  resultCount?: number
  supportsCategories: boolean
}

export interface YouTubeVideo {
  id: string
  title: string
  channel: string
  channelId?: string
  views: number
  durationText?: string
  durationSeconds?: number
  thumbnail?: string
  description?: string
  publishedText?: string
  url: string
}

export interface MediaMetadata {
  title: string
  year?: number
  imdbId?: string
  tmdbId?: number
  poster?: string
  backdrop?: string
  rating?: number
  runtimeMinutes?: number
  genres: string[]
  synopsis?: string
  yearMatch: boolean
}

export interface SearchSuggestion {
  tmdbId: number
  title: string
  year?: number
  kind: 'movie' | 'tv'
  rating?: number
}

export type DiscoverKind = 'movie' | 'tv'
export type DiscoverSort = 'popular' | 'rating' | 'newest'

/** A TMDB title shown in Discover, with everything needed to search torrents. */
export interface DiscoverItem {
  tmdbId: number
  kind: DiscoverKind
  title: string
  year?: number
  rating?: number
  poster?: string
  backdrop?: string
  overview?: string
  genreIds: number[]
}

/** An audio stream inside a media file, as probed by ffmpeg. */
export interface AudioTrackInfo {
  /** 0-based ordinal among the file's audio streams (what `-map 0:a:N` uses). */
  index: number
  /** ISO 639 tag from the container, e.g. "eng"; undefined when untagged. */
  language?: string
  /** "title" metadata, e.g. "Director's commentary". */
  title?: string
  /** Codec name as printed by ffmpeg, e.g. "aac", "dts". */
  codec?: string
  channels?: number
  isDefault?: boolean
}

export interface TorrentFile {
  index: number
  name: string
  size: number
  ext: string
  isVideo: boolean
  isSubtitle: boolean
}

export interface StreamTarget {
  sessionId: string
  fileIndex: number
  url: string
  mode: 'direct' | 'hls'
  mimeType: string
  contentLength: number
  supportsRange: boolean
  durationSeconds?: number
  width?: number
  height?: number
  needsTranscode: boolean
  reason?: string
}

export interface PlaybackProgress {
  infoHash: string
  fileIndex: number
  positionSec: number
  durationSec?: number
  updatedAt: number
  title?: string
  /** Optional enrichment from the originating search result. */
  theme?: Theme
  imdbId?: string
}

export type DownloadItemStatus = 'downloading' | 'complete' | 'missing' | 'error' | 'paused'

export interface DownloadItemFile {
  index: number
  name: string
  /** Absolute path on disk. */
  path: string
  size: number
  ext: string
  isVideo: boolean
  isSubtitle: boolean
}

/**
 * A movie/show tracked by PTM: either an active/finished torrent download or
 * a file imported from disk. Keyed by infoHash for torrents, or
 * `file:<sha1 of the path>` for imports.
 */
export interface DownloadItem {
  id: string
  kind: 'torrent' | 'file'
  infoHash?: string
  /** Raw release/file name. */
  name: string
  /** Clean title parsed from the name (filename-only matching, no network). */
  title: string
  year?: number
  theme: Theme
  files: DownloadItemFile[]
  status: DownloadItemStatus
  /** 0–1; 1 once the download completes. */
  progress: number
  addedAt: number
  completedAt?: number
}

export interface LibraryEntry {
  infoHash: string
  /** Torrent name (release name). */
  name: string
  /** Clean human title, if known, otherwise the release name. */
  title: string
  /** Which file inside the torrent was being played. */
  fileIndex: number
  theme: Theme
  imdbId?: string
  lastPlayedAt: number
  positionSec: number
  durationSec?: number
}

export type ProxyType = 'http' | 'socks5'

export interface ProxyConfig {
  enabled: boolean
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

export interface AppSettings {
  proxy: ProxyConfig
  providers: Record<string, boolean>
  trackers: string[]
  tmdbApiKey?: string
  downloadDir?: string
  autoplayReviews: boolean
  /** Pause the <video> element when the window is minimized; resume on restore. */
  pausePlaybackOnMinimize: boolean
  /** ISO 639 audio language tag preferred across files, e.g. "eng". */
  preferredAudioLanguage?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  proxy: { enabled: false, type: 'http', host: '127.0.0.1', port: 7890 },
  // 1337x serves a Cloudflare challenge to non-browser clients; leave it off
  // unless the user has a proxy that gets through.
  providers: { '1337x': false },
  trackers: [
    // WSS trackers survive corporate networks that block UDP and plain HTTP.
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    // HTTPS trackers with valid certs for normal networks.
    'https://tr.burnabyhighstar.com/announce',
    'https://tracker.bt4g.com/announce',
    'https://tracker.torrent.eu.org:443/announce',
    // UDP trackers — fine on open networks, dead on filtered ones.
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce'
  ],
  autoplayReviews: true,
  pausePlaybackOnMinimize: false
}

export interface DiagnosticResult {
  name: string
  ok: boolean
  detail: string
  durationMs: number
  category: 'index' | 'tracker' | 'metadata' | 'youtube' | 'proxy'
}

export interface DownloadsSummary {
  /** Torrents currently downloading (or uploading). */
  activeCount: number
  /** Torrents paused by the user or by the minimize hook. */
  pausedCount: number
  totalDownloadSpeed: number
}
