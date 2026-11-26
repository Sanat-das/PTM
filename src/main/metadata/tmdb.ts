import type { DiscoverItem, MediaMetadata, ProxyConfig, SearchSuggestion } from '../../shared/types.ts'
import type { DiscoverRequest, DiscoverResponse } from '../../shared/ipc.ts'
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
  genre_ids?: number[]
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

/**
 * Google-style autocomplete suggestions: top movie/TV matches for a partial
 * query, straight from the multi-search endpoint. Deliberately cheap — no
 * per-result details calls. Returns [] when no TMDB key is configured or the
 * query is too short, so the dropdown simply stays closed.
 */
export async function fetchSuggestions(
  query: string,
  proxy?: ProxyConfig
): Promise<SearchSuggestion[]> {
  const apiKey = settings.get().tmdbApiKey
  if (!apiKey) return []

  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      query: trimmed,
      include_adult: 'false'
    })
    const found = await httpJson<TmdbSearchResponse>(
      `https://api.themoviedb.org/3/search/multi?${params.toString()}`,
      { proxy, timeout: 8000 }
    )
    return (found.results ?? [])
      .filter((r) => !r.media_type || r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 6)
      .map((r) => {
        const date = r.release_date ?? r.first_air_date
        const isTv =
          r.media_type === 'tv' || (!r.release_date && Boolean(r.first_air_date))
        return {
          tmdbId: r.id,
          title: (isTv ? r.name : r.title) ?? r.title ?? r.name ?? trimmed,
          year: date ? Number(date.slice(0, 4)) || undefined : undefined,
          kind: isTv ? ('tv' as const) : ('movie' as const),
          rating: r.vote_average
        }
      })
      .filter((s) => s.title.trim().length > 0)
  } catch (error) {
    console.error('[tmdb] suggestion lookup failed', (error as Error).message)
    return []
  }
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
        `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`,
        opts
      )
      const movie = found.movie_results?.[0]
      const tv = found.tv_results?.[0]
      if (movie) {
        kind = 'movie'
        details = await httpJson<TmdbDetails>(
          `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${encodeURIComponent(apiKey)}`,
          opts
        )
      } else if (tv) {
        kind = 'tv'
        details = await httpJson<TmdbDetails>(
          `https://api.themoviedb.org/3/tv/${tv.id}?api_key=${encodeURIComponent(apiKey)}`,
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
        `https://api.themoviedb.org/3/${kind}/${candidate.id}?api_key=${encodeURIComponent(apiKey)}`,
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

/**
 * TMDB Discover: a query-free feed driven by the user's choices (kind, genre,
 * year, rating, sort). Returns `configured: false` when there is no API key so
 * the UI can point at Settings instead of showing a misleading empty grid.
 */
export async function fetchDiscover(
  request: DiscoverRequest,
  proxy?: ProxyConfig
): Promise<DiscoverResponse> {
  const apiKey = settings.get().tmdbApiKey
  if (!apiKey) return { items: [], configured: false }

  const kind = request.kind === 'tv' ? 'tv' : 'movie'
  const params = new URLSearchParams({
    api_key: apiKey,
    include_adult: 'false',
    include_video: 'false',
    page: String(Number.isInteger(request.page) && request.page! > 0 ? Math.min(request.page!, 100) : 1)
  })

  switch (request.sort) {
    case 'rating':
      params.set('sort_by', 'vote_average.desc')
      // Without a vote floor, "top rated" is full of 1-vote 10/10 titles.
      params.set('vote_count.gte', '100')
      break
    case 'newest':
      params.set('sort_by', kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc')
      break
    default:
      params.set('sort_by', 'popularity.desc')
  }

  if (request.genreId) params.set('with_genres', String(request.genreId))
  if (request.year) {
    params.set(kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(request.year))
  }
  if (request.minRating) params.set('vote_average.gte', String(request.minRating))

  try {
    const payload = await httpJson<{ results?: TmdbSearchResult[] }>(
      `https://api.themoviedb.org/3/discover/${kind}?${params.toString()}`,
      { proxy, timeout: 12000 }
    )
    const items: DiscoverItem[] = (payload.results ?? []).map((r) => {
      const date = r.release_date ?? r.first_air_date
      return {
        tmdbId: r.id,
        kind,
        title: (kind === 'tv' ? r.name : r.title) ?? r.title ?? r.name ?? 'Untitled',
        year: date ? Number(date.slice(0, 4)) || undefined : undefined,
        rating: r.vote_average || undefined,
        poster: r.poster_path ? `${IMAGE_BASE}${r.poster_path}` : undefined,
        backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}` : undefined,
        overview: r.overview || undefined,
        genreIds: r.genre_ids ?? []
      }
    })
    return { items, configured: true }
  } catch (error) {
    console.error('[tmdb] discover failed', (error as Error).message)
    return { items: [], configured: true }
  }
}
