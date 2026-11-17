import type { TorrentResult } from '../../shared/types.ts'

/**
 * Cross-provider de-duplication, two passes:
 *
 * 1. By info hash — identical files from any index.
 * 2. By release identity (title | year | season | episode | resolution | source | codec)
 *    — the same release from indexes that don't expose hashes (1337x) still
 *    merges with hashed rows from other indexes. Deliberately excludes the
 *    release group: scene-style and plain-style names parse it differently.
 *
 * Merged rows keep the higher seeder count and fill in any metadata the
 * winning row is missing (magnet, hash, imdb id, url).
 */

/** Seeder-weighted merge; `a` and `b` are assumed to describe the same release. */
function mergeRow(a: TorrentResult, b: TorrentResult): TorrentResult {
  const [keep, other] = b.seeders > a.seeders ? [b, a] : [a, b]
  const providerLabel = [...new Set([...keep.providerLabel.split(', '), ...other.providerLabel.split(', ')])].join(
    ', '
  )
  return {
    ...keep,
    providerLabel,
    magnet: keep.magnet ?? other.magnet,
    infoHash: keep.infoHash ?? other.infoHash,
    imdbId: keep.imdbId ?? other.imdbId,
    url: keep.url ?? other.url,
    addedAt: keep.addedAt ?? other.addedAt,
    fileCount: keep.fileCount ?? other.fileCount,
    uploader: keep.uploader ?? other.uploader,
    status: keep.status ?? other.status,
    size: keep.size || other.size
  }
}

/**
 * Episode tag such as "- 12 [1080p]" for anime-style names (SxxEyy is already
 * parsed). The lookahead accepts a bracket, the end of the string, or a
 * resolution/source marker — scene names like "Show Name - 12 1080p WEB-DL"
 * would otherwise merge distinct episodes.
 */
const EP_TAG_RE = /[-–—]\s*(\d{1,3})(?:v\d)?(?=\s*(?:\[|\(|$|\b\d{3,4}[pi]\b|\b(?:web|blu-?ray|x26[45]|h26[45]|hevc|hd-?tv)\b))/i

function identityKey(result: TorrentResult): string | null {
  const release = result.release
  const title = release.title.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!title) return null
  const epTag = release.season === undefined ? EP_TAG_RE.exec(result.name)?.[1] : undefined
  const season = release.season !== undefined ? `s${release.season}` : ''
  const episode =
    release.episode !== undefined ? `e${release.episode}` : epTag !== undefined ? `e${epTag}` : ''
  return [
    title,
    release.year ?? '',
    season,
    episode,
    release.resolution,
    release.source,
    release.codec
  ].join('|')
}

export function dedupe(results: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>()
  const hashless: TorrentResult[] = []

  for (const result of results) {
    const key = result.infoHash?.toLowerCase()
    if (!key) {
      hashless.push(result)
      continue
    }
    const existing = byHash.get(key)
    byHash.set(key, existing ? mergeRow(existing, result) : result)
  }

  const unique: TorrentResult[] = []
  const byIdentity = new Map<string, TorrentResult>()
  for (const result of [...byHash.values(), ...hashless]) {
    const key = identityKey(result)
    if (!key) {
      unique.push(result)
      continue
    }
    const existing = byIdentity.get(key)
    byIdentity.set(key, existing ? mergeRow(existing, result) : result)
  }

  return [...unique, ...byIdentity.values()]
}
