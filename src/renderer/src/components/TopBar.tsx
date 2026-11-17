import { useEffect, useRef, useState } from 'react'
import { Activity, Library, Pause, Search, Settings as SettingsIcon } from 'lucide-react'
import { formatBytes } from '../../../shared/filters.ts'
import type { DownloadsSummary } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'

interface TopBarProps {
  engine: 'builtin' | 'qbittorrent'
  onEngineChange: (engine: 'builtin' | 'qbittorrent') => void
  onOpenSettings: () => void
  onOpenLibrary: () => void
  onOpenDiagnostics: () => void
}

export function TopBar({
  engine,
  onEngineChange,
  onOpenSettings,
  onOpenLibrary,
  onOpenDiagnostics
}: TopBarProps) {
  const { query, setQuery, submit } = useUiStore()
  const [focused, setFocused] = useState(false)
  const [summary, setSummary] = useState<DownloadsSummary>({
    activeCount: 0,
    pausedCount: 0,
    totalDownloadSpeed: 0
  })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.downloadsSummary().then(setSummary).catch(() => {})
    return api.onDownloadsSummary(setSummary)
  }, [])

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
          submit()
        }}
      >
        <div
          className={`flex w-full max-w-2xl items-center gap-2 rounded-lg border bg-ink-800 px-3 transition-colors ${
            focused ? 'border-accent-500' : 'border-ink-600'
          }`}
        >
          <Search size={16} className="shrink-0 text-mist-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search movies, shows, anime…  (Ctrl+K)"
            className="h-9 w-full bg-transparent text-sm text-mist-100 placeholder:text-mist-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="shrink-0 rounded-md bg-accent-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </form>

      <div className="flex shrink-0 items-center gap-1.5">
        <DownloadsPill summary={summary} />

        <div className="oc-segmented flex overflow-hidden rounded-lg border border-ink-600">
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
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
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

function DownloadsPill({ summary }: { summary: DownloadsSummary }) {
  if (summary.activeCount === 0 && summary.pausedCount === 0) return null

  const hasPaused = summary.pausedCount > 0
  const speed = formatBytes(summary.totalDownloadSpeed)

  return (
    <div
      role="status"
      aria-label={`${summary.activeCount} downloading, ${summary.pausedCount} paused`}
      title={`${summary.activeCount} downloading, ${summary.pausedCount} paused`}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium tabular-nums ${
        hasPaused
          ? 'border-warn-500/40 bg-warn-500/10 text-warn-500'
          : 'border-accent-600/40 bg-accent-600/10 text-accent-400'
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
    </div>
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
