import type { MediaMetadata } from '../../shared/types.ts'
import { httpJson } from '../net/http.ts'
import { settings } from '../settings.ts'

interface TmdbSearchResponse {
  results: Array<{
    id: number
    title?: string
    name?: string
    release_date?: string
    first_air_date?: string
    overview?: string
    poster_path?: string | null
    backdrop_path?: string | null
    vote_average?: number
    imdb_id?: string | null
  }>
}

interface TmdbDetails {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  overview?: string
  runtime?: number
  vote_average?: number
  imdb_id?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  genres: Array<{ id: number; name: string }>
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

/**
 * TMDB lookups are optional — the app works without an API key, it just loses
 * posters, ratings and genres.
 */
export async function fetchMetadata(
  title: string,
  year?: number,
  imdbId?: string
): Promise<MediaMetadata | null> {
  const apiKey = settings.get().tmdbApiKey
  if (!apiKey) return null

  const trimmed = title.trim()
  if (!trimmed && !imdbId) return null

  try {
    let details: TmdbDetails | null = null

    if (imdbId) {
      const found = await httpJson<TmdbSearchResponse>(
        `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&external_source=imdb_id`,
        { timeout: 12000 }
      )
      const first = found.results?.[0] as { id: number } | undefined
      if (first?.id) {
        details = await httpJson<TmdbDetails>(
          `https://api.themoviedb.org/3/movie/${first.id}?api_key=${apiKey}`,
          { timeout: 12000 }
        )
      }
    }

    if (!details) {
      const query = new URLSearchParams({
        api_key: apiKey,
        query: trimmed,
        include_adult: 'false'
      })
      if (year) query.set('year', String(year))
      const found = await httpJson<TmdbSearchResponse>(
        `https://api.themoviedb.org/3/search/multi?${query.toString()}`,
        { timeout: 12000 }
      )
      const candidate = (found.results ?? []).find((r) => {
        const date = r.release_date ?? r.first_air_date
        const candidateYear = date ? Number(date.slice(0, 4)) : undefined
        if (!year || !candidateYear) return true
        return Math.abs(candidateYear - year) <= 1
      })
      if (!candidate?.id) return null

      const isTv = 'first_air_date' in candidate && !('release_date' in candidate)
      details = await httpJson<TmdbDetails>(
        `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${candidate.id}?api_key=${apiKey}`,
        { timeout: 12000 }
      )
    }

    const releaseDate = details.release_date ?? details.first_air_date
    const resolvedYear = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined

    return {
      title: details.title ?? details.name ?? trimmed,
      year: resolvedYear,
      imdbId: details.imdb_id ?? imdbId,
      tmdbId: details.id,
      poster: details.poster_path ? `${IMAGE_BASE}${details.poster_path}` : undefined,
      backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : undefined,
      rating: details.vote_average,
      runtimeMinutes: details.runtime,
      genres: (details.genres ?? []).map((g) => g.name),
      synopsis: details.overview,
      yearMatch: !year || !resolvedYear || Math.abs(resolvedYear - year) <= 1
    }
  } catch (error) {
    console.error('[tmdb] lookup failed', (error as Error).message)
    return null
  }
}
