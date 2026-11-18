import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types.ts'
import { JsonStore } from './store.ts'

class SettingsManager {
  private store = new JsonStore<AppSettings>('settings.json', { ...DEFAULT_SETTINGS })
  private listeners = new Set<(s: AppSettings) => void>()

  get(): AppSettings {
    const raw = this.store.get() as Partial<AppSettings> & { pauseWhenMinimized?: boolean }
    // Migrate the retired "pause downloads on minimize" flag into the playback one.
    const pausePlaybackOnMinimize =
      raw.pausePlaybackOnMinimize ?? raw.pauseWhenMinimized ?? DEFAULT_SETTINGS.pausePlaybackOnMinimize
    const merged = {
      ...DEFAULT_SETTINGS,
      ...raw,
      pausePlaybackOnMinimize,
      proxy: { ...DEFAULT_SETTINGS.proxy, ...(raw.proxy ?? {}) },
      qbittorrent: { ...DEFAULT_SETTINGS.qbittorrent, ...(raw.qbittorrent ?? {}) },
      trackers: Array.isArray(raw.trackers) ? raw.trackers : DEFAULT_SETTINGS.trackers,
      providers: raw.providers ?? {}
    }
    delete (merged as Record<string, unknown>).pauseWhenMinimized
    return merged
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const next = this.get()
    // Deep-merge nested objects so a partial patch (e.g. { proxy: { enabled: false } })
    // doesn't reset the untouched fields to the package defaults.
    const merged = {
      ...next,
      ...patch,
      proxy: { ...next.proxy, ...(patch.proxy ?? {}) },
      qbittorrent: { ...next.qbittorrent, ...(patch.qbittorrent ?? {}) },
      providers: patch.providers ? { ...next.providers, ...patch.providers } : next.providers
    }
    this.store.replace(merged)
    const value = this.get()
    for (const listener of this.listeners) listener(value)
    return value
  }

  onChange(listener: (s: AppSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush(): void {
    this.store.flush()
  }
}

export const settings = new SettingsManager()
