import type { EngineAddInput, EngineSession, TorrentEngine } from './types.ts'
import { BuiltinEngine } from './builtin.ts'

/** Owns the built-in WebTorrent engine — the only download engine. */
class EngineManager {
  readonly builtin = new BuiltinEngine()

  private listeners = new Set<(session: EngineSession) => void>()

  constructor() {
    this.builtin.onUpdate((session) => this.notify(session))
  }

  get engine(): TorrentEngine {
    return this.builtin
  }

  get list(): TorrentEngine[] {
    return [this.builtin]
  }

  async add(input: EngineAddInput): Promise<EngineSession> {
    return this.builtin.add(input)
  }

  /** Kept for callers that tear down by session id across engines. */
  async remove(sessionId: string): Promise<void> {
    await this.builtin.remove(sessionId)
  }

  async setPaused(sessionId: string, paused: boolean): Promise<EngineSession | undefined> {
    return this.builtin.setPaused(sessionId, paused)
  }

  engineFor(sessionId: string): TorrentEngine | undefined {
    return this.builtin.get(sessionId) ? this.builtin : undefined
  }

  get(sessionId: string): EngineSession | undefined {
    return this.builtin.get(sessionId)
  }

  onUpdate(cb: (session: EngineSession) => void): void {
    this.listeners.add(cb)
  }

  private notify(session: EngineSession): void {
    for (const listener of this.listeners) listener(session)
  }

  async destroy(): Promise<void> {
    await this.builtin.destroy()
  }
}

export const engineManager = new EngineManager()
