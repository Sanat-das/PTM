import type { MediaMetadata, ProxyConfig } from '../../shared/types.ts'
import { httpJson } from '../net/http.ts'
import { settings } from '../settings.ts'

interface TmdbSearchResult {
  id: number
  media_type?: string
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number
  imdb_id?: string | null
}

interface TmdbFindResponse {
  movie_results?: TmdbSearchResult[]
  tv_results?: TmdbSearchResult[]
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[]
}

interface TmdbDetails {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  overview?: string
  /** Movies carry `runtime` (minutes). */
  runtime?: number
  /** TV shows carry `episode_run_time: number[]`. */
  episode_run_time?: number[]
  vote_average?: number
  imdb_id?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  genres: Array<{ id: number; name: string }>
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

type Kind = 'movie' | 'tv'

/**
 * TMDB lookups are optional — the app works without an API key, it just loses
 * posters, ratings and genres. All requests honour the app's proxy setting;
 * URLs carry the api_key, which the HTTP layer redacts from error messages
 * before they reach the logs.
 */
export async function fetchMetadata(
  title: string,
  year?: number,
  imdbId?: string,
  proxy?: ProxyConfig
): Promise<MediaMetadata | null> {
  const apiKey = settings.get().tmdbApiKey
  if (!apiKey) return null

  const trimmed = title.trim()
  if (!trimmed && !imdbId) return null

  const opts = { proxy, timeout: 12000 }

  try {
    let kind: Kind = 'movie'
    let details: TmdbDetails | null = null

    if (imdbId) {
      // The /find response is keyed by result type, not by a generic results array.
      const found = await httpJson<TmdbFindResponse>(
        `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&external_source=imdb_id`,
        opts
      )
      const movie = found.movie_results?.[0]
      const tv = found.tv_results?.[0]
      if (movie) {
        kind = 'movie'
        details = await httpJson<TmdbDetails>(
          `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${apiKey}`,
          opts
        )
      } else if (tv) {
        kind = 'tv'
        details = await httpJson<TmdbDetails>(
          `https://api.themoviedb.org/3/tv/${tv.id}?api_key=${apiKey}`,
          opts
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
        opts
      )
      const candidates = (found.results ?? []).filter((r) => {
        if (r.media_type && r.media_type !== 'movie' && r.media_type !== 'tv') return false
        const date = r.release_date ?? r.first_air_date
        const candidateYear = date ? Number(date.slice(0, 4)) : undefined
        if (!year || !candidateYear) return true
        return Math.abs(candidateYear - year) <= 1
      })
      const candidate = candidates[0]
      if (!candidate?.id) return null

      kind =
        candidate.media_type === 'tv' ||
        ('first_air_date' in candidate && !('release_date' in candidate))
          ? 'tv'
          : 'movie'
      details = await httpJson<TmdbDetails>(
        `https://api.themoviedb.org/3/${kind}/${candidate.id}?api_key=${apiKey}`,
        opts
      )
    }

    const releaseDate = details.release_date ?? details.first_air_date
    const resolvedYear = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined
    const runtimeMinutes =
      kind === 'tv' ? details.episode_run_time?.[0] : details.runtime

    return {
      title: details.title ?? details.name ?? trimmed,
      year: resolvedYear,
      imdbId: details.imdb_id ?? imdbId,
      tmdbId: details.id,
      poster: details.poster_path ? `${IMAGE_BASE}${details.poster_path}` : undefined,
      backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : undefined,
      rating: details.vote_average,
      runtimeMinutes,
      genres: (details.genres ?? []).map((g) => g.name),
      synopsis: details.overview,
      yearMatch: !year || !resolvedYear || Math.abs(resolvedYear - year) <= 1
    }
  } catch (error) {
    console.error('[tmdb] lookup failed', (error as Error).message)
    return null
  }
}
