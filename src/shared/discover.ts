/** Static browsing data shared by the main process and the renderer. */

import type { DiscoverKind, DiscoverSort, Theme } from './types.ts'

export interface BrowseCategory {
  id: string
  label: string
  description: string
  /** Client-side theme filter for this category. */
  theme?: Theme
  /** Provider-native category id (The Pirate Bay `cat`). */
  category?: string
}

/**
 * Browse without typing a query: each entry maps to a theme plus, where the
 * index supports it, a native category id. Unknown/empty queries are valid for
 * apibay, YTS and Nyaa, which return the newest rows in that category.
 */
export const BROWSE_CATEGORIES: BrowseCategory[] = [
  {
    id: 'movies',
    label: 'Movies',
    description: 'Latest movie releases across the indexes.',
    theme: 'movies',
    category: '200'
  },
  {
    id: 'web-movies',
    label: 'WEB Movies',
    description: 'Recent WEB-DL and WEBRip movie releases.',
    theme: 'movies',
    category: '209'
  },
  {
    id: 'bluray',
    label: 'BluRay',
    description: 'Disc-quality movie releases.',
    theme: 'movies',
    category: '207'
  },
  {
    id: 'tv',
    label: 'TV Shows',
    description: 'Series, season packs and episodes.',
    theme: 'tv',
    category: '205'
  },
  {
    id: 'tv-hd',
    label: 'HD TV',
    description: 'High-definition series and episodes.',
    theme: 'tv',
    category: '208'
  },
  {
    id: 'anime',
    label: 'Anime',
    description: 'Anime releases, mostly from Nyaa.',
    theme: 'anime'
  },
  {
    id: 'music',
    label: 'Music',
    description: 'Albums, singles and music videos.',
    theme: 'music',
    category: '100'
  },
  {
    id: 'games',
    label: 'Games',
    description: 'PC and console games.',
    theme: 'games',
    category: '400'
  },
  {
    id: 'books',
    label: 'Books',
    description: 'Ebooks, comics and magazines.',
    theme: 'books',
    category: '600'
  },
  {
    id: 'apps',
    label: 'Apps',
    description: 'Software and mobile apps.',
    theme: 'apps',
    category: '300'
  }
]

export interface GenreOption {
  id: number
  name: string
}

/** TMDB's stable genre ids, so the chips work without an extra API call. */
export const MOVIE_GENRES: GenreOption[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' }
]

export const TV_GENRES: GenreOption[] = [
  { id: 10759, name: 'Action & Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' },
  { id: 10765, name: 'Sci-Fi & Fantasy' },
  { id: 10768, name: 'War & Politics' },
  { id: 37, name: 'Western' }
]

export function genresFor(kind: DiscoverKind): GenreOption[] {
  return kind === 'movie' ? MOVIE_GENRES : TV_GENRES
}

export const DISCOVER_SORT_LABELS: Record<DiscoverSort, string> = {
  popular: 'Most popular',
  rating: 'Top rated',
  newest: 'Newest'
}
