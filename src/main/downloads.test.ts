import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setUserDataDir } from './app-paths.ts'
import { settings } from './settings.ts'
import { downloads } from './downloads.ts'
import type { EngineSession } from './engine/types.ts'

/** Download library lifecycle: add → progress → complete, then disk import. */

function fakeSession(overrides: Partial<EngineSession> = {}): EngineSession {
  return {
    id: 'engine-session-1',
    infoHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    name: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
    files: [
      {
        index: 0,
        name: 'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv',
        path: '',
        size: 1_500_000_000,
        ext: 'mkv',
        isVideo: true,
        isSubtitle: false
      }
    ],
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    numPeers: 0,
    state: 'downloading',
    paused: false,
    ...overrides
  }
}

test('torrent lifecycle: add, progress, complete, delete files', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-downloads-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const magnet =
    'magnet:?xt=urn:btih:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2&dn=The.Matrix.1999.1080p.BluRay.x264-GROUP'
  const added = downloads.trackAdd({
    magnet,
    title: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
    sessionId: 'engine-session-1'
  })
  assert.equal(added.status, 'downloading')
  assert.equal(added.title, 'The Matrix')
  assert.equal(added.year, 1999)

  const mid = downloads.trackProgress(fakeSession({ progress: 0.42, state: 'downloading' }))
  assert.ok(mid)
  assert.equal(mid.item.progress, 0.42)
  assert.equal(mid.item.status, 'downloading')
  assert.equal(mid.justCompleted, false)

  const videoPath = path.join(dir, 'video.mkv')
  fs.writeFileSync(videoPath, 'data')
  const done = downloads.trackProgress(
    fakeSession({
      progress: 1,
      state: 'complete',
      files: [
        {
          index: 0,
          name: 'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv',
          path: videoPath,
          size: 4,
          ext: 'mkv',
          isVideo: true,
          isSubtitle: false
        }
      ]
    })
  )
  assert.ok(done)
  assert.equal(done.item.status, 'complete')
  assert.equal(done.justCompleted, true)
  assert.equal(done.item.files[0]?.path, videoPath)

  // A second pass over the same completion does not re-fire the event.
  const again = downloads.trackProgress(
    fakeSession({
      progress: 1,
      state: 'complete',
      files: [
        {
          index: 0,
          name: 'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv',
          path: videoPath,
          size: 4,
          ext: 'mkv',
          isVideo: true,
          isSubtitle: false
        }
      ]
    })
  )
  assert.equal(again?.justCompleted, false)

  const removed = await downloads.remove(added.id, true)
  assert.equal(removed.failed.length, 0)
  assert.equal(removed.deleted, 1)
  assert.equal(fs.existsSync(videoPath), false)
  assert.equal(downloads.list().find((item) => item.id === added.id), undefined)
})

test('scan imports untracked video files with sibling subtitles, skips known', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-scan-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const mediaDir = path.join(dir, 'media')
  fs.mkdirSync(mediaDir, { recursive: true })
  const videoPath = path.join(mediaDir, 'Inception.2010.1080p.WEB-DL.x264-GROUP.mkv')
  const subPath = path.join(mediaDir, 'Inception.2010.1080p.WEB-DL.x264-GROUP.eng.srt')
  fs.writeFileSync(videoPath, 'video-bytes')
  fs.writeFileSync(subPath, 'subtitle-bytes')

  settings.set({ downloadDir: mediaDir })
  t.after(() => settings.set({ downloadDir: undefined }))

  const first = await downloads.scan()
  assert.equal(first.added, 1)

  const item = downloads.list().find((entry) => entry.name === path.basename(videoPath))
  assert.ok(item)
  assert.equal(item.kind, 'file')
  assert.equal(item.title, 'Inception')
  assert.equal(item.year, 2010)
  assert.equal(item.status, 'complete')
  const subtitle = item.files.find((file) => file.isSubtitle)
  assert.equal(subtitle?.path, subPath)

  // Re-scanning finds everything already tracked.
  const second = await downloads.scan()
  assert.equal(second.added, 0)
  assert.equal(second.skipped, 1)

  // Deleting the video makes the entry flip to missing.
  fs.unlinkSync(videoPath)
  const listed = downloads.list().find((entry) => entry.id === item.id)
  assert.equal(listed?.status, 'missing')
})
