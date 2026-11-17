import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRelease } from './release.ts'

test('trailing numbers in movie titles survive the parse', () => {
  const apollo = parseRelease('Apollo 13 1080p BluRay x264')
  assert.equal(apollo.title, 'Apollo 13')
  assert.equal(apollo.resolution, '1080p')

  const race = parseRelease('Race 2 720p BluRay')
  assert.equal(race.title, 'Race 2')
})

test('WEB-DL at the end of the name is the source, not a group', () => {
  const parsed = parseRelease('Creed 3 2023 1080p WEB-DL')
  assert.equal(parsed.source, 'WEB-DL')
  assert.equal(parsed.group, undefined)
  assert.ok(!parsed.title.includes('DL'), `title leaked the DL token: ${parsed.title}`)
})

test('trailing bare number is stripped only for detected TV episodes', () => {
  const tv = parseRelease('Show Name S01E01 1080p WEB-DL')
  assert.equal(tv.season, 1)
  assert.ok(!/\d$/.test(tv.title), `TV title should not keep a stray trailing digit: ${tv.title}`)

  const movie = parseRelease('Creed 3 2023 WEB-DL 1080p')
  assert.equal(movie.title, 'Creed 3')
})

test('space-separated H 264 codec parses as x264', () => {
  const parsed = parseRelease('Some Movie 2020 H 264 1080p')
  assert.equal(parsed.codec, 'x264')
})
