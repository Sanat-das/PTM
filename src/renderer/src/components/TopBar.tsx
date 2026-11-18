import { useEffect, useRef, useState } from 'react'
import { Activity, Film, Library, Pause, Search, Settings as SettingsIcon, Tv } from 'lucide-react'
import { formatBytes } from '../../../shared/filters.ts'
import type { DownloadsSummary, SearchSuggestion } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

interface TopBarProps {
  engine: 'builtin' | 'qbittorrent'
  onEngineChange: (engine: 'builtin' | 'qbittorrent') => void
  /** True while a settings write is in flight — disables the engine toggle. */
  engineDisabled?: boolean
  onOpenSettings: () => void
  onOpenLibrary: () => void
  onOpenDiagnostics: () => void
}

export function TopBar({
  engine,
  onEngineChange,
  engineDisabled = false,
  onOpenSettings,
  onOpenLibrary,
  onOpenDiagnostics
}: TopBarProps) {
  const query = useUiStore((state) => state.query)
  const setQuery = useUiStore((state) => state.setQuery)
  const submit = useUiStore((state) => state.submit)
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [summary, setSummary] = useState<DownloadsSummary>({
    activeCount: 0,
    pausedCount: 0,
    totalDownloadSpeed: 0
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestRequest = useRef(0)

  useEffect(() => {
    void api.downloadsSummary().then(setSummary).catch(() => {})
    return api.onDownloadsSummary(setSummary)
  }, [])

  // Debounced TMDB title suggestions while the user types. A monotonically
  // increasing request id drops stale responses so the list never flickers
  // out of order.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      // Invalidate any in-flight suggestion request too, or its late
      // response repopulates the dropdown for the shrunken query.
      suggestRequest.current += 1
      setSuggestions([])
      setActiveIndex(-1)
      setSuggestionsOpen(false)
      return
    }
    const id = ++suggestRequest.current
    const timer = setTimeout(() => {
      api
        .searchSuggest(trimmed)
        .then((items) => {
          if (id !== suggestRequest.current) return
          setSuggestions(items)
          setActiveIndex(-1)
          setSuggestionsOpen(items.length > 0)
        })
        .catch(() => {})
    }, 180)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pickSuggestion = (suggestion: SearchSuggestion) => {
    const text = suggestion.year ? `${suggestion.title} ${suggestion.year}` : suggestion.title
    setQuery(text)
    setSuggestions([])
    setActiveIndex(-1)
    setSuggestionsOpen(false)
    submit()
  }

  const showSuggestions = suggestionsOpen && focused && suggestions.length > 0

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-850 px-4">
      <div className="flex items-center gap-2 select-none">
        <span className="text-lg font-bold tracking-tight text-mist-100">PTM</span>
        <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
      </div>

      <form
        className="flex min-w-0 flex-1 justify-center"
        onSubmit={(event) => {
          event.preventDefault()
          if (showSuggestions && activeIndex >= 0) {
            pickSuggestion(suggestions[activeIndex])
            return
          }
          setSuggestionsOpen(false)
          submit()
        }}
      >
        <div className="relative w-full max-w-2xl">
          <div
            className={`flex w-full items-center gap-2 border bg-ink-800 px-3 transition-colors ${
              focused ? 'border-accent-500' : 'border-ink-600'
            } ${showSuggestions ? 'rounded-t-lg rounded-b-none border-b-transparent' : 'rounded-lg'}`}
          >
            <Search size={16} className="shrink-0 text-mist-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => {
                setFocused(true)
                if (suggestions.length > 0) setSuggestionsOpen(true)
              }}
              onBlur={() => {
                setFocused(false)
                setSuggestionsOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && showSuggestions) {
                  event.preventDefault()
                  setActiveIndex((index) => (index + 1) % suggestions.length)
                } else if (event.key === 'ArrowUp' && showSuggestions) {
                  event.preventDefault()
                  setActiveIndex((index) =>
                    index <= 0 ? suggestions.length - 1 : index - 1
                  )
                } else if (event.key === 'Enter' && showSuggestions && activeIndex >= 0) {
                  event.preventDefault()
                  pickSuggestion(suggestions[activeIndex])
                } else if (event.key === 'Escape' && suggestionsOpen) {
                  event.preventDefault()
                  setSuggestionsOpen(false)
                }
              }}
              placeholder="Search movies, shows, anime…  (Ctrl+K)"
              role="combobox"
              aria-label="Search movies, shows, anime"
              aria-expanded={showSuggestions}
              aria-controls="ptm-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                showSuggestions && activeIndex >= 0 ? `ptm-suggestion-${activeIndex}` : undefined
              }
              className="h-9 w-full bg-transparent text-sm text-mist-100 placeholder:text-mist-400"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="shrink-0 rounded-md bg-accent-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Search
            </button>
          </div>
          {showSuggestions && (
            <ul
              id="ptm-suggestions"
              role="listbox"
              aria-label="Suggestions"
              className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-xl border border-t-0 border-accent-500 bg-ink-800 py-1 shadow-2xl shadow-black/50"
            >
              {suggestions.map((suggestion, index) => {
                const typed = query.trim().toLowerCase()
                const prefixLength =
                  typed && suggestion.title.toLowerCase().startsWith(typed) ? typed.length : 0
                const active = index === activeIndex
                return (
                  <li
                    key={`${suggestion.kind}-${suggestion.tmdbId}`}
                    id={`ptm-suggestion-${index}`}
                    role="option"
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickSuggestion(suggestion)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                        active ? 'bg-ink-700' : ''
                      }`}
                    >
                      {suggestion.kind === 'tv' ? (
                        <Tv size={15} className="shrink-0 text-mist-400" />
                      ) : (
                        <Film size={15} className="shrink-0 text-mist-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-mist-100">
                        <span className="text-mist-400">{suggestion.title.slice(0, prefixLength)}</span>
                        <span className="font-medium">{suggestion.title.slice(prefixLength)}</span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-mist-400">
                        {suggestion.kind === 'tv' ? 'Series' : 'Movie'}
                        {suggestion.year ? ` · ${suggestion.year}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </form>

      <div className="flex shrink-0 items-center gap-1.5">
        <DownloadsPill summary={summary} onOpenLibrary={onOpenLibrary} />

        <div
          role="group"
          aria-label="Download engine"
          title="Switch between the built-in engine and qBittorrent"
          className="oc-segmented flex overflow-hidden rounded-lg border border-ink-600"
        >
          {(
            [
              { id: 'builtin', label: 'Built-in' },
              { id: 'qbittorrent', label: 'qBittorrent' }
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              onClick={() => onEngineChange(option.id)}
              aria-pressed={engine === option.id}
              disabled={engineDisabled}
              title={option.id === 'qbittorrent' ? 'Download via qBittorrent (no instant streaming)' : 'Built-in engine (instant streaming)'}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                engine === option.id
                  ? 'bg-accent-600 text-white'
                  : 'bg-ink-800 text-mist-400 hover:text-mist-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <IconButton label="Diagnostics" onClick={onOpenDiagnostics}>
          <Activity size={16} />
        </IconButton>
        <IconButton label="Library" onClick={onOpenLibrary}>
          <Library size={16} />
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <SettingsIcon size={16} />
        </IconButton>
      </div>
    </header>
  )
}

function DownloadsPill({
  summary,
  onOpenLibrary
}: {
  summary: DownloadsSummary
  onOpenLibrary: () => void
}) {
  if (summary.activeCount === 0 && summary.pausedCount === 0) return null

  const hasPaused = summary.pausedCount > 0
  const speed = formatBytes(summary.totalDownloadSpeed)
  const label = `${summary.activeCount} downloading, ${summary.pausedCount} paused`

  return (
    <button
      type="button"
      onClick={onOpenLibrary}
      aria-label={`${label} — open Library`}
      title={`${label} — open Library`}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium tabular-nums transition-colors ${
        hasPaused
          ? 'border-warn-500/40 bg-warn-500/10 text-warn-500 hover:bg-warn-500/20'
          : 'border-accent-600/40 bg-accent-600/10 text-accent-400 hover:bg-accent-600/20'
      }`}
    >
      {summary.activeCount > 0 ? (
        <>
          <span aria-hidden>↓</span>
          <span>{speed}/s</span>
          <span className="text-mist-400">· {summary.activeCount}</span>
          {hasPaused && (
            <span className="flex items-center gap-1 text-warn-500">
              <Pause size={10} fill="currentColor" />
              {summary.pausedCount}
            </span>
          )}
        </>
      ) : (
        <>
          <Pause size={11} fill="currentColor" />
          <span>
            Paused · {summary.pausedCount}
          </span>
        </>
      )}
    </button>
  )
}

function IconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-lg border border-ink-600 bg-ink-800 p-2 text-mist-400 transition-colors hover:border-ink-500 hover:text-mist-100"
    >
      {children}
    </button>
  )
}
