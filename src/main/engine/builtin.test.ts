import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setUserDataDir } from '../app-paths.ts'
import { settings } from '../settings.ts'
import { BuiltinEngine } from './builtin.ts'

/** Regression tests for the built-in engine's session and pause handling. */

const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'

test('adding the same magnet twice reuses the existing session', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-builtin-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  settings.set({ downloadDir: undefined, pauseWhenMinimized: false })

  const engine = new BuiltinEngine()
  t.after(() => engine.destroy())

  const first = await engine.add({ magnet: MAGNET, title: 'Sintel' })
  const second = await engine.add({ magnet: MAGNET, title: 'Sintel' })

  assert.equal(second.id, first.id, 'should not spawn a duplicate session')
  assert.equal(engine.list().length, 1, 'should not add a duplicate torrent')
  assert.equal(first.paused, false)
})

test('pause and resume flip the session state', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-builtin-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  settings.set({ downloadDir: undefined, pauseWhenMinimized: false })

  const engine = new BuiltinEngine()
  t.after(() => engine.destroy())

  const session = await engine.add({ magnet: MAGNET, title: 'Sintel' })

  const paused = await engine.setPaused(session.id, true)
  assert.ok(paused, 'pause should return the session')
  assert.equal(paused.paused, true)
  assert.equal(paused.state, 'paused')

  const resumed = await engine.setPaused(session.id, false)
  assert.ok(resumed, 'resume should return the session')
  assert.equal(resumed.paused, false)
  assert.notEqual(resumed.state, 'paused')

  // Re-adding while paused resumes rather than erroring.
  const pausedAgain = await engine.setPaused(session.id, true)
  assert.equal(pausedAgain?.paused, true)
  const reused = await engine.add({ magnet: MAGNET, title: 'Sintel' })
  assert.equal(reused.paused, false, 're-adding a paused torrent resumes it')
})

test('pause on an unknown session returns undefined', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-builtin-'))
  setUserDataDir(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const engine = new BuiltinEngine()
  t.after(() => engine.destroy())

  assert.equal(await engine.setPaused('nope', true), undefined)
})
