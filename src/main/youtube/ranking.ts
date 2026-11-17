/**
 * Pure ranking logic for the trailer panel.
 * Kept separate from the InnerTube client so it can be unit tested.
 */

/** Words too common to be useful for relevance matching. */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'to',
  'is',
  'it',
  'or',
  'on',
  'for',
  'with',
  'at',
  'by'
])

/** Trailers, teasers and red-band clips count as trailers. */
const TRAILER_RE =
  /\b(trailer|trailers|teaser|sneak\s?peek|red ?band|green ?band|final cut|exclusive footage|preview)\b/i

/** Reactions, reviews and essays are never trailers. */
const NON_TRAILER_RE =
  /\b(reaction|review|analysis|explained|breakdown|recap|theory|ending|interview|video essay|behind the scenes|making of|featurette|documentary|how they|asmr)\b/i

/** "Official" in the title always wins. */
const OFFICIAL_RE = /\bofficial\b/i

/** Titles from a major studio channel count as official even without the word. */
const MAJOR_STUDIO_RE =
  /(warner bros|universal pictures|paramount pictures|20th century fox|columbia pictures|sony pictures|disney|marvel studios|lucasfilm|pixar|dreamworks|lionsgate|mgm|new line cinema|amazon mgm|focus features|searchlight pictures)/i

export interface RankableVideo {
  id: string
  title: string
  channel: string
  views: number
  durationSeconds?: number
}

export const STUDIO_QUERY_TERMS =
  'Warner Bros OR Universal Pictures OR Paramount Pictures OR Sony Pictures OR 20th Century Studios OR Disney OR Lionsgate'

function relevanceKeys(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

/**
 * A trailer is only relevant if its title or channel mentions every
 * distinctive word of the film. Keeps "Dune" from surfacing Dune card-games.
 */
function isRelevantTo(text: string, keys: string[]): boolean {
  return keys.length === 0 || keys.every((key) => text.includes(key))
}

/**
 * Orders candidate videos into a trailer list.
 *
 * Primary pool: relevant, looks like a trailer, not a reaction/essay/round
 * table. Falls back to any relevant video when that leaves nothing, so an
 * obscure title still gets a panel.
 */
export function rankTrailers(videos: RankableVideo[], title: string): RankableVideo[] {
  const normalized = title.trim().toLowerCase()
  if (!normalized) return []
  const keys = relevanceKeys(normalized)

  const scored = videos
    .map((video) => {
      const videoTitle = video.title.toLowerCase()
      const channel = video.channel.toLowerCase()
      // Relevance and "is this a trailer" look at the title and channel only —
      // descriptions are long and mention the title for unrelated videos.
      const text = `${video.title} ${video.channel}`.toLowerCase()

      const isTrailer = TRAILER_RE.test(videoTitle)
      const isNonTrailer = NON_TRAILER_RE.test(videoTitle)
      const isOfficial = OFFICIAL_RE.test(videoTitle) || MAJOR_STUDIO_RE.test(channel)
      const relevant = isRelevantTo(text, keys)

      let score = video.views
      if (isTrailer) score *= 2.5
      if (isOfficial) score *= 1.4
      if (text.includes(normalized)) score *= 1.2
      if (video.durationSeconds && video.durationSeconds < 20) score *= 0.4
      if (video.durationSeconds && video.durationSeconds > 240) score *= 0.6
      else if (video.durationSeconds && video.durationSeconds >= 60 && video.durationSeconds <= 210) {
        score *= 1.1
      }
      if (!relevant) score *= 0.02

      return { video, score, isTrailer, isNonTrailer, isOfficial, relevant }
    })
    .sort((a, b) => b.score - a.score)

  const primary = scored.filter(
    (entry) => entry.relevant && entry.isTrailer && !entry.isNonTrailer
  )
  // Only widen to any relevant video when no trailer found at all, so an
  // obscure title still gets something to show.
  const pool = primary.length > 0 ? primary : scored.filter((entry) => entry.relevant)

  return pool.slice(0, 12).map((entry) => entry.video)
}
