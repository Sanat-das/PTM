import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dedupe } from './dedupe.ts'
import { parseRssDate } from './util.ts'
import { parseRelease } from '../../shared/release.ts'
import type { TorrentResult } from '../../shared/types.ts'

function makeResult(overrides: Partial<TorrentResult> = {}): TorrentResult {
  const name = overrides.name ?? 'Show Name - 01 1080p WEB-DL x264'
  return {
    id: `test:${Math.random()}`,
    provider: 'test',
    providerLabel: 'Test',
    name,
    seeders: 10,
    leechers: 1,
    size: 1_000_000_000,
    category: '205',
    theme: 'tv',
    release: parseRelease(name),
    ...overrides
  }
}

test('distinct episodes in scene naming do not merge', () => {
  const ep12 = makeResult({ name: 'Show Name - 12 1080p WEB-DL x264' })
  const ep13 = makeResult({ name: 'Show Name - 13 1080p WEB-DL x264' })
  const merged = dedupe([ep12, ep13])
  assert.equal(merged.length, 2, 'episodes 12 and 13 must stay separate rows')
})

test('the same episode from two providers merges', () => {
  const a = makeResult({ name: 'Show Name - 12 1080p WEB-DL x264', seeders: 30 })
  const b = makeResult({ name: 'Show Name - 12 1080p WEB-DL x264-GROUP', seeders: 10 })
  const merged = dedupe([a, b])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 30)
})

test('1337x ordinal dates parse as unix seconds', () => {
  const ts = parseRssDate("Aug. 17th '26")
  assert.ok(ts !== undefined && ts > 0)
  assert.equal(new Date(ts * 1000).getUTCFullYear(), 2026)
  assert.equal(new Date(ts * 1000).getUTCMonth(), 7)
  assert.equal(new Date(ts * 1000).getUTCDate(), 17)
  assert.equal(parseRssDate("Sep 1st '24"), Math.floor(Date.UTC(2024, 8, 1) / 1000))
  assert.equal(parseRssDate('not a date'), undefined)
})
