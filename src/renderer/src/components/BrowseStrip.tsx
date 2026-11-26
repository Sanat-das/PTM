import { BROWSE_CATEGORIES } from '../../../shared/discover.ts'
import { useUiStore } from '../lib/store.ts'

/** Category tiles for query-free browsing. Genre browsing lives in Discover. */
export function BrowseStrip() {
  const browseCategory = useUiStore((state) => state.browseCategory)
  const setBrowseCategory = useUiStore((state) => state.setBrowseCategory)

  const active = BROWSE_CATEGORIES.find((entry) => entry.id === browseCategory) ?? BROWSE_CATEGORIES[0]

  return (
    <section className="shrink-0 border-b border-ink-700 bg-ink-850/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {BROWSE_CATEGORIES.map((category) => {
          const selected = category.id === active.id
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setBrowseCategory(category.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? 'border-accent-500 bg-accent-600/20 text-accent-400'
                  : 'border-ink-600 bg-ink-800 text-mist-200 hover:border-ink-500 hover:text-mist-100'
              }`}
            >
              {category.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-mist-400">{active.description}</p>
    </section>
  )
}
