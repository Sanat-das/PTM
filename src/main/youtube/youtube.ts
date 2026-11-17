import { Innertube } from 'youtubei.js'
import type { YouTubeVideo } from '../../shared/types.ts'
import { STUDIO_QUERY_TERMS, rankTrailers } from './ranking.ts'

let clientPromise: Promise<Innertube> | null = null

async function getClient(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create().catch((error) => {
      clientPromise = null
      throw error
    })
  }
  return clientPromise
}

/** youtubei.js returns some fields as Text objects rather than plain strings. */
function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'text' in value) {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return String(value)
}

function parseDuration(value: unknown): number | undefined {
  const text = asText(value)
  if (!text) return undefined
  const parts = text.split(':').map((p) => Number(p))
  if (parts.some((p) => Number.isNaN(p))) return undefined
  return parts.reduce((acc, part) => acc * 60 + part, 0)
}

/** view_count arrives as Text such as "294,127 views". */
function parseViewCount(value: unknown): number {
  if (typeof value === 'number') return value
  const digits = asText(value).replace(/[^\d]/g, '')
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The InnerTube search response is a union of several item shapes. We only
 * care about the video shape, so it is narrowed here explicitly.
 */
interface SearchVideo {
  id: string
  title?: unknown
  author?: { name?: unknown; id?: string }
  view_count?: unknown
  length_text?: unknown
  thumbnails?: Array<{ url?: string }>
  description_snippet?: unknown
  published?: unknown
}

/** One retry per query; InnerTube occasionally drops a request. */
async function searchOnce(
  client: Innertube,
  query: string
): Promise<{ videos?: unknown[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await client.search(query, { type: 'video' })) as unknown as {
        videos?: unknown[]
      }
    } catch (error) {
      if (attempt === 1) {
        console.error('[youtube] search failed', query, (error as Error).message)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  return null
}

/**
 * Search YouTube for trailers of a title.
 * Uses the InnerTube API, so no API key is required.
 */
export async function searchTrailers(title: string, year?: number): Promise<YouTubeVideo[]> {
  const cleanTitle = title.trim()
  if (!cleanTitle) return []

  const yearPart = year ? ` ${year}` : ''
  const queries = [
    `${cleanTitle}${yearPart} official trailer`,
    `${cleanTitle}${yearPart} trailer`,
    `${cleanTitle}${yearPart} teaser ${STUDIO_QUERY_TERMS}`
  ]

  const client = await getClient()
  const collected = new Map<string, YouTubeVideo>()

  for (const query of queries) {
    const results = await searchOnce(client, query)
    const videos = (results?.videos ?? []) as SearchVideo[]

    for (const video of videos) {
      const id = video.id
      if (!id || collected.has(id)) continue

      const videoTitle = asText(video.title)
      const channel = asText(video.author?.name)

      collected.set(id, {
        id,
        title: videoTitle,
        channel,
        channelId: video.author?.id,
        views: parseViewCount(video.view_count),
        durationText: asText(video.length_text) || undefined,
        durationSeconds: parseDuration(video.length_text),
        thumbnail:
          video.thumbnails?.[video.thumbnails.length - 1]?.url ??
          video.thumbnails?.[0]?.url ??
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        description: asText(video.description_snippet),
        publishedText: asText(video.published) || undefined,
        url: `https://www.youtube.com/watch?v=${id}`
      })
    }
  }

  if (collected.size === 0) return []

  const ranked = rankTrailers(
    [...collected.values()].map((video) => ({
      id: video.id,
      title: video.title,
      channel: video.channel,
      views: video.views,
      durationSeconds: video.durationSeconds
    })),
    cleanTitle
  )

  return ranked
    .map((video) => collected.get(video.id))
    .filter((video): video is YouTubeVideo => Boolean(video))
}
