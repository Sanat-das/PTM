import { Clapperboard, Compass, Search } from 'lucide-react'
import { useUiStore, type View } from '../lib/store.ts'

const TABS: Array<{ id: View; label: string; icon: typeof Search }> = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'browse', label: 'Browse', icon: Compass },
  { id: 'discover', label: 'Discover', icon: Clapperboard }
]

export function ViewTabs() {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)

  return (
    <nav
      aria-label="View"
      className="flex shrink-0 items-center gap-1 border-b border-ink-700 bg-ink-900 px-4 py-1.5"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = view === id
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-accent-600/20 text-accent-400'
                : 'text-mist-400 hover:bg-ink-800 hover:text-mist-100'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
      <span className="ml-3 hidden text-[11px] text-mist-400 sm:inline">
        {view === 'browse'
          ? 'Newest releases by category — no search needed'
          : view === 'discover'
            ? 'Find titles by genre, year and rating, then search their torrents'
            : 'Search every index at once'}
      </span>
    </nav>
  )
}
