import type { LibraryEntry, PlaybackProgress } from '../shared/types.ts'
import { JsonStore } from './store.ts'

type LibraryData = Record<string, LibraryEntry>

class LibraryManager {
  private store = new JsonStore<LibraryData>('library.json', {})

  list(): LibraryEntry[] {
    return Object.values(this.store.get()).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  }

  saveProgress(progress: PlaybackProgress): LibraryEntry {
    const current = this.store.get()
    const existing = current[progress.infoHash]
    const entry: LibraryEntry = {
      infoHash: progress.infoHash,
      name: progress.title ?? existing?.name ?? 'Unknown',
      title: existing?.title ?? progress.title ?? 'Unknown',
      fileIndex: progress.fileIndex ?? existing?.fileIndex ?? 0,
      theme: progress.theme ?? existing?.theme ?? 'other',
      imdbId: progress.imdbId ?? existing?.imdbId,
      lastPlayedAt: Date.now(),
      positionSec: progress.positionSec,
      durationSec: progress.durationSec ?? existing?.durationSec
    }
    this.store.set({ [progress.infoHash]: entry })
    return entry
  }

  remove(infoHash: string): void {
    const current = { ...this.store.get() }
    delete current[infoHash]
    this.store.replace(current)
  }

  flush(): void {
    this.store.flush()
  }
}

export const library = new LibraryManager()
