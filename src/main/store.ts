import { getUserDataDir } from './app-paths.ts'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Tiny atomic JSON store. Avoids native modules (no better-sqlite3 rebuild) while
 * still giving durable settings, library and playback positions.
 *
 * The directory is resolved lazily rather than at construction time so the
 * module can be imported before the data directory is pinned down (tests do).
 */
export class JsonStore<T extends object> {
  private readonly fileName: string
  private data: T
  private writeTimer: NodeJS.Timeout | null = null

  constructor(fileName: string, defaults: T) {
    this.fileName = fileName
    this.data = this.read(defaults)
  }

  private get file(): string {
    return path.join(getUserDataDir(), this.fileName)
  }

  private read(defaults: T): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<T>
      return { ...defaults, ...parsed }
    } catch {
      return { ...defaults }
    }
  }

  get(): T {
    return this.data
  }

  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch }
    this.scheduleWrite()
    return this.data
  }

  replace(value: T): T {
    this.data = value
    this.scheduleWrite()
    return this.data
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (error) {
      console.error('[store] failed to persist', this.file, error)
    }
  }
}
