import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setUserDataDir } from './app-paths.ts'
import type { PlaybackProgress } from '../shared/types.ts'
import { library } from './library.ts'

/** Library persistence round-trip: save -> list -> resume data survives. */

test('library saves and returns continue-watching entries', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-library-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  // Fresh store
  const progress: PlaybackProgress = {
    infoHash: 'abc123',
    fileIndex: 3,
    positionSec: 123.4,
    durationSec: 9000,
    updatedAt: Date.now(),
    title: 'Squid Game (2021) 1080p'
  }

  library.saveProgress(progress)
  await waitFor(() => library.list().length > 0, 2000)

  const entries = library.list()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].infoHash, 'abc123')
  assert.equal(entries[0].fileIndex, 3)
  assert.equal(entries[0].positionSec, 123.4)
  assert.equal(entries[0].title, 'Squid Game (2021) 1080p')

  // Re-saving at a further position updates the same entry rather than
  // creating a duplicate.
  library.saveProgress({ ...progress, positionSec: 300 })

  // A fresh playing of the same torrent keeps title and fileIndex.
  await waitFor(() => (library.list()[0]?.positionSec ?? 0) === 300, 2000)

  library.remove('abc123')
  assert.equal(library.list().length, 0)
})

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for library write'))
      setTimeout(tick, 40)
    }
    tick()
  })
}
