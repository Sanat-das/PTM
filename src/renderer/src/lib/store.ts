import { create } from 'zustand'
import {
  DEFAULT_FILTERS,
  type Codec,
  type Resolution,
  type SearchFilters,
  type Source,
  type SortKey,
  type Theme,
  type TorrentResult
} from '../../../shared/types.ts'

export type Panel = 'none' | 'settings' | 'library' | 'diagnostics'

interface UiState {
  query: string
  submitted: string
  filters: SearchFilters
  selected: TorrentResult | null
  panel: Panel
  player: { sessionId: string; fileIndex: number; resumePositionSec?: number; title?: string } | null
  setQuery: (query: string) => void
  submit: () => void
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
    opts?: { resumePositionSec?: number; title?: string }
  ) => void
  closePlayer: () => void
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export const useUiStore = create<UiState>((set) => ({
  query: '',
  submitted: '',
  filters: { ...DEFAULT_FILTERS },
  selected: null,
  panel: 'none',
  player: null,

  setQuery: (query) => set({ query }),
  submit: () => set((state) => ({ submitted: state.query.trim() })),

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
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  select: (selected) => set({ selected }),
  setPanel: (panel) => set({ panel }),
  openPlayer: (sessionId, fileIndex, opts) =>
    set({ player: { sessionId, fileIndex, resumePositionSec: opts?.resumePositionSec, title: opts?.title } }),
  closePlayer: () => set({ player: null })
}))

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'seeders', label: 'Seeders' },
  { value: 'size', label: 'Size' },
  { value: 'date', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'leechers', label: 'Fewest leechers' }
]
