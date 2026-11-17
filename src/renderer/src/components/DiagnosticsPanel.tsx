import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'
import { Overlay } from './SettingsPanel.tsx'

export function DiagnosticsPanel() {
  const setPanel = useUiStore((state) => state.setPanel)

  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => api.diagnostics(),
    // Diagnostics probe the whole network — don't re-fire every time the
    // panel is opened; the Re-run button exists for that.
    staleTime: 60_000
  })

  return (
    <Overlay onClose={() => setPanel('none')} label="Network diagnostics">
      <header className="flex items-center border-b border-ink-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-mist-100">Network diagnostics</h2>
        <button
          onClick={() => void diagnostics.refetch()}
          className="ml-auto rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-mist-200 hover:text-mist-100"
        >
          Re-run
        </button>
      </header>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-5">
        {diagnostics.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-mist-400">
            <Loader2 size={16} className="spin" />
            Testing indexes, trackers and services…
          </div>
        )}

        {diagnostics.isError && (
          <div className="rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
            Diagnostics failed: {(diagnostics.error as Error).message}
            <button
              onClick={() => void diagnostics.refetch()}
              className="ml-2 underline hover:text-mist-100"
            >
              Retry
            </button>
          </div>
        )}

        {diagnostics.data?.map((result) => (
          <div
            key={result.name}
            className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2"
          >
            {result.ok ? (
              <CheckCircle2 size={15} className="shrink-0 text-good-500" />
            ) : (
              <XCircle size={15} className="shrink-0 text-bad-500/80" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-mist-100">{result.name}</div>
              <div className="truncate text-[11px] text-mist-400">{result.detail}</div>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-mist-400">{result.durationMs}ms</span>
          </div>
        ))}

        {diagnostics.data && (
          <p className="pt-3 text-[11px] leading-relaxed text-mist-400">
            Indexes marked red are blocked or unreachable from this machine. If you run a local VPN
            or proxy, enable it in Settings and re-run. UDP trackers and DHT cannot be tunnelled —
            use the qBittorrent engine if your setup relies on them.
          </p>
        )}
      </div>
    </Overlay>
  )
}
