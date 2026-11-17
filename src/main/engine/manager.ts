import type { EngineAddInput, EngineSession, TorrentEngine } from './types.ts'
import { BuiltinEngine } from './builtin.ts'
import { QbittorrentEngine } from './qbittorrent.ts'

/**
 * Keeps the built-in engine and the qBittorrent adapter in sync and exposes
 * whichever one the user selected.
 */
class EngineManager {
  readonly builtin = new BuiltinEngine()
  readonly qbittorrent = new QbittorrentEngine()

  private active: TorrentEngine = this.builtin
  private listeners = new Set<(session: EngineSession) => void>()

  constructor() {
    this.builtin.onUpdate((session) => this.notify(session))
    this.qbittorrent.onUpdate((session) => this.notify(session))
  }

  get engine(): TorrentEngine {
    return this.active
  }

  get list(): TorrentEngine[] {
    return [this.builtin, this.qbittorrent]
  }

  use(id: 'builtin' | 'qbittorrent'): void {
    this.active = id === 'qbittorrent' ? this.qbittorrent : this.builtin
  }

  async add(input: EngineAddInput): Promise<EngineSession> {
    return this.active.add(input)
  }

  /** Removes the session from both engines; harmless on non-owners. */
  async remove(sessionId: string): Promise<void> {
    await this.builtin.remove(sessionId)
    await this.qbittorrent.remove(sessionId)
  }

  /** Tries the active engine first, then the other. */
  async setPaused(sessionId: string, paused: boolean): Promise<EngineSession | undefined> {
    const first = await this.active.setPaused(sessionId, paused)
    if (first) return first
    return this.active === this.qbittorrent
      ? this.builtin.setPaused(sessionId, paused)
      : this.qbittorrent.setPaused(sessionId, paused)
  }

  /** The engine that owns a session, if any. */
  engineFor(sessionId: string): TorrentEngine | undefined {
    if (this.builtin.get(sessionId)) return this.builtin
    if (this.qbittorrent.get(sessionId)) return this.qbittorrent
    return undefined
  }

  get(sessionId: string): EngineSession | undefined {
    return this.builtin.get(sessionId) ?? this.qbittorrent.get(sessionId)
  }

  onUpdate(cb: (session: EngineSession) => void): void {
    this.listeners.add(cb)
  }

  private notify(session: EngineSession): void {
    for (const listener of this.listeners) listener(session)
  }

  async destroy(): Promise<void> {
    await this.builtin.destroy()
    await this.qbittorrent.destroy()
  }
}

export const engineManager = new EngineManager()
