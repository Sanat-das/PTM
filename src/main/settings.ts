import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types.ts'
import { JsonStore } from './store.ts'

class SettingsManager {
  private store = new JsonStore<AppSettings>('settings.json', { ...DEFAULT_SETTINGS })
  private listeners = new Set<(s: AppSettings) => void>()

  get(): AppSettings {
    const raw = this.store.get()
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      proxy: { ...DEFAULT_SETTINGS.proxy, ...(raw.proxy ?? {}) },
      qbittorrent: { ...DEFAULT_SETTINGS.qbittorrent, ...(raw.qbittorrent ?? {}) },
      trackers: raw.trackers?.length ? raw.trackers : DEFAULT_SETTINGS.trackers,
      providers: raw.providers ?? {}
    }
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const next = this.get()
    this.store.replace({ ...next, ...patch })
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
