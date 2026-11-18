import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_SETTINGS, type AppSettings, type ProxyType } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { useUiStore } from '../lib/store.ts'
import { PTM_VERSION } from '../../../shared/version.ts'

const PROVIDER_NAMES: Record<string, string> = {
  apibay: 'The Pirate Bay (apibay)',
  nyaa: 'Nyaa',
  yts: 'YTS',
  '1337x': '1337x',
  eztv: 'EZTV'
}

const PREFERRED_AUDIO_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'eng', label: 'English' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'ita', label: 'Italian' },
  { value: 'rus', label: 'Russian' },
  { value: 'kor', label: 'Korean' },
  { value: 'chi', label: 'Chinese' },
  { value: 'por', label: 'Portuguese' },
  { value: 'ara', label: 'Arabic' },
  { value: 'hin', label: 'Hindi' },
  { value: 'pol', label: 'Polish' },
  { value: 'tur', label: 'Turkish' },
  { value: 'dut', label: 'Dutch' },
  { value: 'swe', label: 'Swedish' },
  { value: 'vie', label: 'Vietnamese' },
  { value: 'tha', label: 'Thai' },
  { value: 'ind', label: 'Indonesian' },
  { value: 'heb', label: 'Hebrew' },
  { value: 'ukr', label: 'Ukrainian' }
]

export function SettingsPanel() {
  const setPanel = useUiStore((state) => state.setPanel)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [defaultDownloads, setDefaultDownloads] = useState('')
  // Raw textarea text for trackers — kept separate so Enter produces a real
  // newline instead of being stripped by the parse-then-join round trip.
  const [trackersText, setTrackersText] = useState('')
  const [discardArmed, setDiscardArmed] = useState(false)
  const savedSnapshot = useRef<string | null>(null)

  const dirty = Boolean(
    draft && savedSnapshot.current !== null && JSON.stringify(draft) !== savedSnapshot.current
  )

  // Closing with unsaved changes needs one extra nudge; closing clean just works.
  const closeWithGuard = () => {
    if (!dirty) {
      setPanel('none')
      return
    }
    if (!discardArmed) {
      setDiscardArmed(true)
      toast.warning('Unsaved changes', { description: 'Click again to discard them.' })
      window.setTimeout(() => setDiscardArmed(false), 4000)
      return
    }
    setPanel('none')
  }

  const load = () => {
    setLoadError(null)
    api
      .settingsGet()
      .then((loaded) => {
        setDraft(loaded)
        setTrackersText(loaded.trackers.join('\n'))
        savedSnapshot.current = JSON.stringify(loaded)
      })
      .catch((error: Error) => setLoadError(error.message))
    void api.defaultDownloads().then(setDefaultDownloads).catch(() => undefined)
  }

  useEffect(load, [])

  const defaultDownloadsLabel = defaultDownloads || 'System Downloads folder'

  if (loadError) {
    return (
      <Overlay onClose={closeWithGuard} label="Settings">
        <div className="p-6 text-sm">
          <p className="text-mist-100">Could not load settings: {loadError}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500"
          >
            Retry
          </button>
        </div>
      </Overlay>
    )
  }

  if (!draft) {
    return (
      <Overlay onClose={closeWithGuard} label="Settings">
        <div className="p-6 text-sm text-mist-400">Loading settings…</div>
      </Overlay>
    )
  }

  const patch = (changes: Partial<AppSettings>) => setDraft({ ...draft, ...changes })

  const save = async () => {
    setSaving(true)
    try {
      const trackers = trackersText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const saved = await api.settingsSet({ ...draft, trackers })
      setDraft(saved)
      setTrackersText(saved.trackers.join('\n'))
      savedSnapshot.current = JSON.stringify(saved)
      // The header engine toggle and the search pipeline read the same cache.
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Settings saved')
    } catch (error) {
      toast.error(`Could not save settings: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={closeWithGuard} label="Settings">
      <header className="flex items-center border-b border-ink-700 px-5 py-3">
        <h2 className="text-sm font-semibold text-mist-100">Settings</h2>
        <button
          onClick={closeWithGuard}
          aria-label="Close settings"
          className="ml-auto rounded p-1 text-mist-400 hover:bg-ink-700 hover:text-mist-100"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <Section title="Network proxy">
          <p className="mb-2 text-xs text-mist-400">
            Used for index lookups and for tunnelling the torrent engine&rsquo;s TCP traffic. UDP
            (DHT and UDP trackers) is not tunnelled.
          </p>
          <label className="mb-2 flex items-center gap-2 text-xs text-mist-200">
            <input
              type="checkbox"
              checked={draft.proxy.enabled}
              onChange={(event) =>
                patch({ proxy: { ...draft.proxy, enabled: event.target.checked } })
              }
              className="accent-[var(--color-accent-500)]"
            />
            Route traffic through a proxy
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={draft.proxy.type}
              onChange={(event) =>
                patch({ proxy: { ...draft.proxy, type: event.target.value as ProxyType } })
              }
              aria-label="Proxy type"
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <input
              value={draft.proxy.host}
              onChange={(event) => patch({ proxy: { ...draft.proxy, host: event.target.value } })}
              placeholder="127.0.0.1"
              aria-label="Proxy host"
              className="w-40 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
            <input
              value={draft.proxy.port}
              type="number"
              onChange={(event) => {
                const port = Number(event.target.value)
                patch({ proxy: { ...draft.proxy, port: Number.isFinite(port) ? port : 0 } })
              }}
              placeholder="7890"
              aria-label="Proxy port"
              min={0}
              max={65535}
              className="w-24 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
            <input
              value={draft.proxy.username ?? ''}
              onChange={(event) => patch({ proxy: { ...draft.proxy, username: event.target.value } })}
              placeholder="username"
              aria-label="Proxy username"
              autoComplete="off"
              className="w-32 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
            <input
              value={draft.proxy.password ?? ''}
              type="password"
              onChange={(event) => patch({ proxy: { ...draft.proxy, password: event.target.value } })}
              placeholder="password"
              aria-label="Proxy password"
              autoComplete="new-password"
              className="w-32 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
          </div>
        </Section>

        <Section title="Indexes">
          <div className="flex flex-col gap-1.5">
            {Object.entries(PROVIDER_NAMES).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 text-xs text-mist-200">
                <input
                  type="checkbox"
                  checked={draft.providers[id] !== false}
                  onChange={(event) =>
                    patch({ providers: { ...draft.providers, [id]: event.target.checked } })
                  }
                  className="accent-[var(--color-accent-500)]"
                />
                {label}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Trackers">
          <p className="mb-2 text-xs text-mist-400">One per line. Used for magnet links.</p>
          <textarea
            value={trackersText}
            onChange={(event) => setTrackersText(event.target.value)}
            rows={7}
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 font-mono text-[11px] text-mist-200"
          />
        </Section>

        <Section title="Metadata">
          <label htmlFor="tmdb-api-key" className="mb-1 block text-xs text-mist-200">TMDB API key (optional)</label>
          <input
            id="tmdb-api-key"
            value={draft.tmdbApiKey ?? ''}
            onChange={(event) => patch({ tmdbApiKey: event.target.value || undefined })}
            placeholder="Paste your api.themoviedb.org key"
            autoComplete="off"
            className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 font-mono text-xs"
          />
          <p className="mt-1 text-[11px] text-mist-400">
            Adds posters, ratings and genres. Everything else works without it.
          </p>
        </Section>

        <Section title="qBittorrent">
          <p className="mb-1.5 text-[11px] text-mist-400">
            qBittorrent only takes over when you switch the engine in the top bar — the
            built-in engine stays the default.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft.qbittorrent.url}
              onChange={(event) =>
                patch({ qbittorrent: { ...draft.qbittorrent, url: event.target.value } })
              }
              placeholder="http://127.0.0.1:8080"
              aria-label="qBittorrent Web UI URL"
              className="w-56 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
            <input
              value={draft.qbittorrent.username ?? ''}
              onChange={(event) =>
                patch({ qbittorrent: { ...draft.qbittorrent, username: event.target.value } })
              }
              placeholder="username"
              aria-label="qBittorrent username"
              autoComplete="off"
              className="w-32 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
            <input
              value={draft.qbittorrent.password ?? ''}
              type="password"
              onChange={(event) =>
                patch({ qbittorrent: { ...draft.qbittorrent, password: event.target.value } })
              }
              placeholder="password"
              aria-label="qBittorrent password"
              autoComplete="new-password"
              className="w-32 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs"
            />
          </div>
        </Section>

        <Section title="Downloads">
          <label className="mb-1 block text-xs text-mist-200">
            Where finished files are saved
          </label>
          <div className="flex items-center gap-2">
            <input
              value={draft.downloadDir ?? ''}
              onChange={(event) => patch({ downloadDir: event.target.value || undefined })}
              placeholder={defaultDownloadsLabel}
              className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 font-mono text-xs text-mist-200"
            />
            <button
              onClick={async () => {
                const picked = await api.pickDirectory(draft.downloadDir || undefined)
                if (picked) setDraft((current) => (current ? { ...current, downloadDir: picked } : current))
              }}
              className="shrink-0 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
            >
              Browse
            </button>
            {draft.downloadDir && (
              <button
                onClick={() => patch({ downloadDir: undefined })}
                title="Use the system Downloads folder"
                className="shrink-0 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
              >
                Default
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-mist-400">
            Defaults to your system Downloads folder. Applies to the built-in engine and to
            qBittorrent as its save path.
          </p>
        </Section>

        <Section title="Behaviour">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-mist-200">
            <input
              type="checkbox"
              checked={draft.pausePlaybackOnMinimize}
              onChange={(event) => patch({ pausePlaybackOnMinimize: event.target.checked })}
              className="accent-[var(--color-accent-500)]"
            />
            Pause video playback while the app is minimized
          </label>
          <p className="mt-1 text-[11px] text-mist-400">
            Pauses the player when you minimize the window and resumes when you come back. Playback
            you paused yourself stays paused.
          </p>
          <label className="mb-1 mt-3 block text-xs text-mist-200">
            Preferred audio language
          </label>
          <select
            value={draft.preferredAudioLanguage ?? ''}
            onChange={(event) =>
              patch({ preferredAudioLanguage: event.target.value || undefined })
            }
            className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-mist-200"
          >
            <option value="">No preference (file default)</option>
            {PREFERRED_AUDIO_LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-mist-400">
            When a file has a matching audio track, it is selected automatically (the stream is
            transcoded in that language). Picking a track in the player updates this too.
          </p>
        </Section>
      </div>

      <footer className="flex items-center gap-2 border-t border-ink-700 px-5 py-3">
        <span className="font-mono text-[10px] text-mist-400" title="PTM app version">
          v{PTM_VERSION}
        </span>
        <button
          onClick={() => {
            setDraft(structuredClone(DEFAULT_SETTINGS))
            setTrackersText(DEFAULT_SETTINGS.trackers.join('\n'))
          }}
          title="Reset the form to default values — press Save to keep them"
          className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs text-mist-200 hover:text-mist-100"
        >
          Reset to defaults
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="ml-auto rounded-lg bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </Overlay>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mist-400">{title}</h3>
      {children}
    </section>
  )
}

export function Overlay({
  title,
  onClose,
  children,
  label
}: {
  title?: string
  onClose: () => void
  children: React.ReactNode
  /** Accessible name for the dialog; falls back to `title`. */
  label?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  // Focus management: land focus inside on open, trap Tab/Shift+Tab within
  // the dialog, and restore focus to whatever opened it on close.
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => previousFocus.current?.focus?.()
  }, [])

  // Escape closes the overlay; Tab cycles within it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey) {
        if (!active || active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (!active || active === last || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title ?? 'Dialog'}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
