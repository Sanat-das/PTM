import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { DownloadItem, DownloadItemFile, DownloadItemStatus } from '../shared/types.ts'
import {
  extensionOf,
  isSubtitleFile,
  isVideoFile,
} from './engine/types.ts'
import type { EngineSession } from './engine/types.ts'
import { createRequire } from 'node:module'
import { parseRelease, themeFromName } from '../shared/release.ts'
import { settings } from './settings.ts'
import { getUserDataDir } from './app-paths.ts'
import { library } from './library.ts'
import { JsonStore } from './store.ts'

type DownloadsData = Record<string, DownloadItem>

/** Folder that new downloads are written to / imports are scanned from. */
export function defaultDownloadRoot(): string {
  const configured = settings.get().downloadDir?.trim()
  if (configured) return configured
  try {
    const { app } = createRequire(import.meta.url)('electron') as typeof import('electron')
    return app.getPath('downloads')
  } catch {
    return path.join(getUserDataDir(), 'torrents')
  }
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/**
 * Move a library file or folder to the system Recycle Bin instead of
 * destroying it outright. Falls back to a hard delete only when Electron is
 * unavailable (unit tests); a trashItem failure propagates so the caller can
 * report the path as not deleted rather than silently destroy it.
 */
async function trashItem(target: string, fallback: 'file' | 'dir'): Promise<void> {
  const fallbackDelete = (): Promise<void> => {
    // No usable Electron shell (unit tests) — old hard-delete behaviour.
    if (fallback === 'file') return fs.promises.unlink(target)
    return fs.promises.rm(target, { recursive: true, force: true })
  }
  let electron: unknown
  try {
    electron = createRequire(import.meta.url)('electron')
  } catch {
    return fallbackDelete()
  }
  // Under plain Node require('electron') yields the binary path, not the API.
  const shell = (electron as { shell?: { trashItem?: (p: string) => Promise<void> } })?.shell
  if (typeof shell?.trashItem !== 'function') return fallbackDelete()
  await shell.trashItem(target)
}

function primaryVideo(item: DownloadItem): DownloadItemFile | undefined {
  return item.files.filter((file) => file.isVideo).sort((a, b) => b.size - a.size)[0]
}

function toItemFile(file: {
  index: number
  name: string
  path: string
  size: number
  ext?: string
  isVideo?: boolean
  isSubtitle?: boolean
}): DownloadItemFile {
  const ext = file.ext ?? extensionOf(file.path)
  return {
    index: file.index,
    name: file.name,
    path: file.path,
    size: file.size,
    ext,
    isVideo: file.isVideo ?? isVideoFile(file.path),
    isSubtitle: file.isSubtitle ?? isSubtitleFile(file.path)
  }
}

class DownloadsManager {
  private store = new JsonStore<DownloadsData>('downloads.json', {})

  /** Own-property store lookup — '__proto__' etc. never resolve to inherited members. */
  private item(id: string): DownloadItem | undefined {
    const raw = this.store.get()
    return Object.prototype.hasOwnProperty.call(raw, id) ? raw[id] : undefined
  }

  get(id: string): DownloadItem | undefined {
    const item = this.item(id)
    return item ? this.withMissingCheck(item) : undefined
  }

  list(): DownloadItem[] {
    return Object.values(this.store.get())
      .map((item) => this.withMissingCheck(item))
      .sort((a, b) => {
        if (a.status === 'downloading' && b.status !== 'downloading') return -1
        if (b.status === 'downloading' && a.status !== 'downloading') return 1
        return b.addedAt - a.addedAt
      })
  }

  /**
   * Lazily re-check that the primary video still exists on disk. Transitions
   * complete→missing when the file vanished, and missing→complete when it reappears.
   */
  private withMissingCheck(item: DownloadItem): DownloadItem {
    if (item.status !== 'complete' && item.status !== 'missing') return item
    const primary = primaryVideo(item)
    if (item.status === 'missing') {
      // The file may have been moved back into place — restore it.
      if (primary && fs.existsSync(primary.path)) {
        const next = { ...item, status: 'complete' as const }
        this.persist(next)
        return next
      }
      return item
    }
    if (primary && !fs.existsSync(primary.path)) {
      const next = { ...item, status: 'missing' as const }
      this.persist(next)
      return next
    }
    return item
  }

  private persist(item: DownloadItem): void {
    this.store.set({ [item.id]: item })
  }

  /**
   * Register (or refresh) a torrent being added. Called from the add handler
   * before metadata arrives; files are filled in by trackProgress().
   */
  trackAdd(input: {
    magnet?: string
    infoHash?: string
    title?: string
    sessionId: string
  }): DownloadItem {
    const rawSourceHash = input.infoHash?.toLowerCase()
    const sourceHash =
      rawSourceHash && /^[0-9a-f]{40}$|^[a-z2-7]{32}$/.test(rawSourceHash) ? rawSourceHash : undefined
    const rawMagnetHash = input.magnet?.match(/xt=urn:btih:([A-Za-z0-9]+)/i)?.[1]?.toLowerCase()
    // Only well-formed btih hashes (40-char hex or 32-char base32) may be
    // adopted as the id — anything else is ignored.
    const magnetHash = rawMagnetHash && /^[0-9a-f]{40}$|^[a-z2-7]{32}$/.test(rawMagnetHash) ? rawMagnetHash : undefined
    const id = sourceHash ?? magnetHash ?? input.sessionId
    const current = this.item(id)
    const name = input.title ?? current?.name ?? 'Unknown'
    const parsed = parseRelease(name)
    const item: DownloadItem = {
      id,
      kind: 'torrent',
      infoHash: sourceHash ?? magnetHash ?? current?.infoHash,
      name,
      title: parsed.title || name,
      year: parsed.year,
      theme: themeFromName(name, parsed),
      files: current?.files ?? [],
      status:
        current?.status === 'complete'
          ? 'complete'
          : 'downloading',
      progress: current?.progress ?? 0,
      addedAt: current?.addedAt ?? Date.now(),
      completedAt: current?.completedAt
    }
    this.persist(item)
    return item
  }

  /** Locates the store key for an engine session: by infoHash, then by the
   *  engine session UUID (entry not yet migrated), then by stored infoHash. */
  private findKey(session: EngineSession): string | undefined {
    const data = this.store.get()
    const hash = session.infoHash?.toLowerCase()
    const own = (key: string): boolean => Object.prototype.hasOwnProperty.call(data, key)
    if (hash && own(hash)) return hash
    if (own(session.id)) return session.id
    if (hash) {
      return Object.entries(data).find(([, item]) => item.infoHash === hash)?.[0]
    }
    return undefined
  }

  /**
   * Mirror engine progress into the store. Handles the pre-metadata → metadata
   * transition (files appear, infoHash may be filled in later) and the
   * completion transition. Returns the updated item plus whether this call is
   * the one that flipped the item to `complete`.
   */
  trackProgress(
    session: EngineSession
  ): { item: DownloadItem; justCompleted: boolean } | null {
    const data = this.store.get()
    const hash = session.infoHash?.toLowerCase()
    let key = this.findKey(session)
    if (!key) {
      // A torrent added before the tracking existed (or without our add
      // handler) — adopt it now so downloads are never invisible.
      if (!hash && session.files.length === 0) return null
      const adopted = this.trackAdd({
        infoHash: hash,
        title: session.name,
        sessionId: session.id
      })
      key = adopted.id
      return this.trackProgress(session)
    }

    const existing = data[key]
    const name = session.name && session.name !== 'Fetching metadata…' ? session.name : existing.name
    const parsed = parseRelease(name)
    const files: DownloadItemFile[] =
      session.files.length > 0 ? session.files.map((file) => toItemFile(file)) : existing.files

    const complete = session.state === 'complete' || session.progress >= 1
    const wasComplete = existing.status === 'complete' || Boolean(existing.completedAt)
    const justCompleted = complete && !wasComplete

    const status: DownloadItemStatus = complete
      ? 'complete'
      : session.state === 'error'
        ? 'error'
        : session.paused || session.state === 'paused'
          ? 'paused'
          : 'downloading'

    const item: DownloadItem = {
      ...existing,
      id: hash ?? existing.id,
      infoHash: hash ?? existing.infoHash,
      name,
      title: parsed.title || name,
      year: parsed.year ?? existing.year,
      theme: existing.theme ?? themeFromName(name, parsed),
      files,
      status,
      progress: complete ? 1 : session.progress,
      addedAt: existing.addedAt,
      completedAt: complete ? (existing.completedAt ?? Date.now()) : existing.completedAt
    }

    // Migrate the key from the session UUID to the info hash once known.
    if (hash && key !== hash) {
      const next = { ...this.store.get() }
      delete next[key]
      // Merge any pre-existing hash entry rather than clobbering it — keep
      // the earliest addedAt/completedAt we know about.
      const existingHashEntry = next[hash]
      next[hash] = existingHashEntry
        ? {
            ...existingHashEntry,
            ...item,
            id: hash,
            addedAt: Math.min(existingHashEntry.addedAt ?? item.addedAt, item.addedAt),
            completedAt: existingHashEntry.completedAt ?? item.completedAt
          }
        : item
      this.store.replace(next)
    } else {
      this.persist(item)
    }

    return { item, justCompleted }
  }

  /** A torrent was stopped/removed before finishing — flag it so the library
   *  does not show a phantom in-progress download. */
  markStopped(session: EngineSession): void {
    const key = this.findKey(session)
    if (!key) return
    const existing = this.item(key)
    if (!existing || existing.status === 'complete') return
    this.persist({ ...existing, status: 'paused' })
  }

  /**
   * Scan the download root for video files that are not yet tracked. Names
   * are parsed locally — no network calls. Sibling subtitle files with the
   * same basename are picked up too so the player's caption menu works.
   *
   * `claimedPaths` (lowercased) are paths belonging to live engine sessions;
   * they are never imported, so a half-written in-flight download is not
   * mistaken for a completed file.
   */
  async scan(claimedPaths?: Set<string>): Promise<{ added: number; skipped: number }> {
    const root = defaultDownloadRoot()
    if (!fs.existsSync(root)) return { added: 0, skipped: 0 }

    const subtitleExts = ['srt', 'sub', 'ass', 'ssa', 'vtt']
    const videoPaths: string[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6) return
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          // Release-folder samples are teaser clips, not separate movies.
          if (entry.name.toLowerCase() === 'sample') continue
          await walk(full, depth + 1)
        } else if (entry.isFile() && isVideoFile(entry.name)) {
          videoPaths.push(full)
        }
      }
    }
    await walk(root, 0)

    const existingPaths = new Set(
      Object.values(this.store.get()).flatMap((item) => item.files.map((file) => file.path.toLowerCase()))
    )

    let added = 0
    let skipped = 0
    for (const videoPath of videoPaths) {
      const lowerPath = videoPath.toLowerCase()
      if (existingPaths.has(lowerPath) || claimedPaths?.has(lowerPath)) {
        skipped += 1
        continue
      }
      try {
        const stat = await fs.promises.stat(videoPath)
        const name = path.basename(videoPath)
        const parsed = parseRelease(name)
        const dir = path.dirname(videoPath)
        const stem = name.slice(0, name.length - path.extname(name).length)
        const ext = extensionOf(name)

        const files: DownloadItemFile[] = [
          {
            index: 0,
            name,
            path: videoPath,
            size: stat.size,
            ext,
            isVideo: true,
            isSubtitle: false
          }
        ]
        // Sibling subtitles with the same basename: Movie.Name.srt, Movie.Name.eng.srt
        let subIndex = 1
        const dirEntries = await fs.promises.readdir(dir)
        for (const sub of dirEntries) {
          const subExt = extensionOf(sub)
          if (!subtitleExts.includes(subExt)) continue
          const subStem = path.basename(sub, path.extname(sub))
          if (subStem === stem || subStem.startsWith(`${stem}.`)) {
            const subPath = path.join(dir, sub)
            try {
              const subStat = await fs.promises.stat(subPath)
              files.push({
                index: subIndex,
                name: sub,
                path: subPath,
                size: subStat.size,
                ext: subExt,
                isVideo: false,
                isSubtitle: true
              })
              subIndex += 1
            } catch {
              // subtitle vanished between readdir and stat — skip it
            }
          }
        }

        const id = `file:${sha1(videoPath.toLowerCase())}`
        const completedAt = stat.mtimeMs
        this.persist({
          id,
          kind: 'file',
          name,
          title: parsed.title || stem,
          year: parsed.year,
          theme: themeFromName(name, parsed),
          files,
          status: 'complete',
          progress: 1,
          addedAt: completedAt,
          completedAt
        })
        added += 1
      } catch {
        skipped += 1
      }
    }
    return { added, skipped }
  }

  /** Removes the record; optionally deletes the files from disk. */
  async remove(
    id: string,
    deleteFiles: boolean
  ): Promise<{ deleted: number; failed: string[] }> {
    const item = this.item(id)
    const failed: string[] = []
    let deleted = 0
    if (item) {
      if (deleteFiles) {
        for (const file of item.files) {
          // Refuse non-absolute paths — a hand-edited store must never
          // unlink relative to the app's working directory.
          if (!path.isAbsolute(file.path)) {
            failed.push(file.path)
            continue
          }
          if (!fs.existsSync(file.path)) {
            // Already gone — count it as removed without an error.
            deleted += 1
            continue
          }
          try {
            await trashItem(file.path, 'file')
            deleted += 1
          } catch {
            failed.push(file.path)
          }
        }
        failed.push(...(await this.removeItemFolders(item)))
      }
      const next = { ...this.store.get() }
      delete next[id]
      this.store.replace(next)
      // The watch-position entry is keyed by the same id — drop it too so a
      // deleted movie does not linger under "Continue watching".
      library.remove(id)
    }
    return { deleted, failed }
  }

  /** Deepest common ancestor of every directory in `dirs`; '' if none. */
  private static commonDir(dirs: string[]): string {
    if (dirs.length === 0) return ''
    let common = dirs[0].split(path.sep)
    for (const dir of dirs.slice(1)) {
      const segs = dir.split(path.sep)
      let i = 0
      while (i < common.length && i < segs.length && common[i] === segs[i]) i++
      common = common.slice(0, i)
      if (common.length === 0) return ''
    }
    return common.join(path.sep)
  }

  /** Recursively list every file path under `dir` (lowercased), skipping errors. */
  private static async listFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (current: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) await walk(full)
        else out.push(full.toLowerCase())
      }
    }
    await walk(dir)
    return out
  }

  /**
   * Release folders (e.g. `Inception.2010.1080p...-GROUP/`) hold files the
   * downloads store does not track (.nfo, cover art, samples). After the
   * tracked files are unlinked, remove the release folder too — but never
   * the download root itself, and never a folder containing files that
   * belong to another tracked item (falls back to removing only
   * now-empty folders).
   *
   * Returns paths that could not be removed.
   */
  private async removeItemFolders(item: DownloadItem): Promise<string[]> {
    const failed: string[] = []
    const root = path.resolve(defaultDownloadRoot())
    const recorded = item.files
      .filter((file) => typeof file.path === 'string' && path.isAbsolute(file.path))
      .map((file) => path.resolve(file.path))
      .filter((p) => p === root || p.startsWith(root + path.sep))
    if (recorded.length === 0) return failed

    const rmdirEmpty = async (): Promise<void> => {
      const dirs = [...new Set(recorded.map((p) => path.dirname(p)))].sort((a, b) => b.length - a.length)
      for (const dir of dirs) {
        let current = dir
        while (current !== root && current.startsWith(root + path.sep)) {
          try {
            await fs.promises.rmdir(current)
          } catch {
            break
          }
          current = path.dirname(current)
        }
      }
    }

    const common = DownloadsManager.commonDir(recorded.map((p) => path.dirname(p)))
    // Flat import or files scattered across the root: leave the root alone.
    if (!common || common === root || !common.startsWith(root + path.sep)) {
      await rmdirEmpty()
      return failed
    }

    // Never delete anything another tracked item owns.
    const otherTracked = new Set(
      Object.values(this.store.get())
        .filter((other) => other.id !== item.id)
        .flatMap((other) => other.files.map((file) => path.resolve(file.path).toLowerCase()))
    )
    if (otherTracked.size > 0) {
      const contents = await DownloadsManager.listFiles(common)
      if (contents.some((p) => otherTracked.has(p))) {
        await rmdirEmpty()
        return failed
      }
    }

    try {
      await trashItem(common, 'dir')
    } catch {
      failed.push(common)
    }
    return failed
  }

  /** Reveal the primary video in the OS file manager. */
  reveal(id: string): boolean {
    const item = this.get(id)
    const primary = item ? primaryVideo(item) : undefined
    return primary ? this.showItem(primary.path) : false
  }

  private showItem(target: string): boolean {
    try {
      const { shell } = createRequire(import.meta.url)('electron') as typeof import('electron')
      shell.showItemInFolder(target)
      return true
    } catch {
      return false
    }
  }

  flush(): void {
    this.store.flush()
  }
}

export const downloads = new DownloadsManager()
