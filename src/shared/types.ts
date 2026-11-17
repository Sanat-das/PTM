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
  hideDead: false
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

export interface QbittorrentConfig {
  url: string
  username?: string
  password?: string
}

export interface AppSettings {
  proxy: ProxyConfig
  providers: Record<string, boolean>
  engine: 'builtin' | 'qbittorrent'
  qbittorrent: QbittorrentConfig
  trackers: string[]
  tmdbApiKey?: string
  downloadDir?: string
  autoplayReviews: boolean
  /** Pause the <video> element when the window is minimized; resume on restore. */
  pausePlaybackOnMinimize: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  proxy: { enabled: false, type: 'http', host: '127.0.0.1', port: 7890 },
  // 1337x serves a Cloudflare challenge to non-browser clients; leave it off
  // unless the user has a proxy that gets through.
  providers: { '1337x': false },
  engine: 'builtin',
  qbittorrent: { url: 'http://127.0.0.1:8080' },
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
