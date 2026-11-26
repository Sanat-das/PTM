import { create } from 'zustand'
import {
  DEFAULT_FILTERS,
  type Codec,
  type DiscoverKind,
  type DiscoverSort,
  type Resolution,
  type SearchFilters,
  type Source,
  type SortKey,
  type Theme,
  type TorrentResult
} from '../../../shared/types.ts'
import { BROWSE_CATEGORIES } from '../../../shared/discover.ts'

export type Panel = 'none' | 'settings' | 'library' | 'diagnostics'
export type View = 'search' | 'browse' | 'discover'

export interface DiscoverSettings {
  kind: DiscoverKind
  genreId: number | null
  year: number | null
  minRating: number | null
  sort: DiscoverSort
}

interface UiState {
  query: string
  submitted: string
  view: View
  browseCategory: string
  discover: DiscoverSettings
  filters: SearchFilters
  selected: TorrentResult | null
  panel: Panel
  player: {
    sessionId: string
    fileIndex: number
    resumePositionSec?: number
    title?: string
    theme?: Theme
    imdbId?: string
  } | null
  setQuery: (query: string) => void
  submit: () => void
  /** Search for a title (used by Discover cards) in one atomic update. */
  searchFor: (query: string, theme?: Theme) => void
  setView: (view: View) => void
  setBrowseCategory: (id: string) => void
  setDiscover: (patch: Partial<DiscoverSettings>) => void
  setFilters: (patch: Partial<SearchFilters>) => void
  toggleTheme: (theme: Theme) => void
  toggleResolution: (value: Resolution) => void
  toggleSource: (value: Source) => void
  toggleCodec: (value: Codec) => void
  resetFilters: () => void
  select: (result: TorrentResult | null) => void
  setPanel: (panel: Panel) => void
  openPlayer: (
    sessionId: string,
    fileIndex: number,
    opts?: { resumePositionSec?: number; title?: string; theme?: Theme; imdbId?: string }
  ) => void
  closePlayer: () => void
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function themeForCategory(id: string): Theme[] {
  const category = BROWSE_CATEGORIES.find((entry) => entry.id === id) ?? BROWSE_CATEGORIES[0]
  return category.theme ? [category.theme] : []
}

export const useUiStore = create<UiState>((set) => ({
  query: '',
  submitted: '',
  view: 'search',
  browseCategory: 'movies',
  discover: { kind: 'movie', genreId: null, year: null, minRating: 7, sort: 'popular' },
  filters: { ...DEFAULT_FILTERS },
  selected: null,
  panel: 'none',
  player: null,

  setQuery: (query) => set({ query }),
  // A text search always lands on the Search view. Submitting while Browse or
  // Discover is active used to leave that view in place, so the query was
  // either ignored (Browse sends an empty query) or its results were hidden.
  submit: () =>
    set((state) => ({
      submitted: state.query.trim(),
      view: 'search',
      // Browse injects a category theme; a plain text search must not inherit
      // it or results outside that category are silently filtered away.
      filters: state.view === 'search' ? state.filters : { ...state.filters, themes: [] }
    })),
  searchFor: (query, theme) =>
    set((state) => ({
      query,
      submitted: query.trim(),
      view: 'search',
      filters: { ...state.filters, themes: theme ? [theme] : [] }
    })),
  setView: (view) =>
    set((state) => {
      if (view === 'browse' && state.filters.themes.length === 0) {
        return { view, filters: { ...state.filters, themes: themeForCategory(state.browseCategory) } }
      }
      // Leaving Browse drops the category theme it injected, so it cannot
      // leak into later searches launched from the Search view.
      if (state.view === 'browse' && view !== 'browse') {
        return { view, filters: { ...state.filters, themes: [] } }
      }
      return { view }
    }),
  setBrowseCategory: (id) =>
    set((state) => ({
      browseCategory: id,
      filters: { ...state.filters, themes: themeForCategory(id) }
    })),
  setDiscover: (patch) => set((state) => ({ discover: { ...state.discover, ...patch } })),

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  toggleTheme: (theme) =>
    set((state) => ({ filters: { ...state.filters, themes: toggle(state.filters.themes, theme) } })),
  toggleResolution: (value) =>
    set((state) => ({
      filters: { ...state.filters, resolutions: toggle(state.filters.resolutions, value) }
    })),
  toggleSource: (value) =>
    set((state) => ({ filters: { ...state.filters, sources: toggle(state.filters.sources, value) } })),
  toggleCodec: (value) =>
    set((state) => ({ filters: { ...state.filters, codecs: toggle(state.filters.codecs, value) } })),
  resetFilters: () =>
    set((state) => ({
      filters: {
        ...DEFAULT_FILTERS,
        themes: state.view === 'browse' ? themeForCategory(state.browseCategory) : []
      }
    })),

  select: (selected) => set({ selected }),
  setPanel: (panel) => set({ panel }),
  openPlayer: (sessionId, fileIndex, opts) =>
    set({
      player: {
        sessionId,
        fileIndex,
        resumePositionSec: opts?.resumePositionSec,
        title: opts?.title,
        theme: opts?.theme,
        imdbId: opts?.imdbId
      }
    }),
  closePlayer: () => set({ player: null })
}))

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'seeders', label: 'Seeders' },
  { value: 'size', label: 'Size' },
  { value: 'date', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'leechers', label: 'Fewest leechers' }
]
