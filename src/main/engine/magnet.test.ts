import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { appendTrackers, infoHashFromTorrent } from './magnet.ts'

test('configured trackers are appended once', () => {
  const magnet = 'magnet:?xt=urn:btih:abc&dn=Example'
  const withTrackers = appendTrackers(magnet, [
    'udp://tracker.example:1337/announce',
    'udp://tracker.example:1337/announce'
  ])

  assert.equal(
    withTrackers,
    `${magnet}&tr=udp%3A%2F%2Ftracker.example%3A1337%2Fannounce`
  )
})

test('trackers already in the magnet are not duplicated', () => {
  const magnet = `magnet:?xt=urn:btih:abc&tr=${encodeURIComponent('udp://tracker.example:1337/announce')}`
  assert.equal(appendTrackers(magnet, ['udp://tracker.example:1337/announce']), magnet)
})

test('non-magnet inputs are returned untouched', () => {
  const url = 'https://example.test/file.torrent'
  assert.equal(appendTrackers(url, ['udp://tracker.example:1337/announce']), url)
})

const INFO_DICT = Buffer.from(
  'd6:lengthi1e4:name8:test.txt12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae'
)

test('the info hash is the sha1 of the info dictionary', () => {
  const torrent = Buffer.concat([Buffer.from('d4:info'), INFO_DICT, Buffer.from('e')])
  const expected = createHash('sha1').update(INFO_DICT).digest('hex')
  assert.equal(infoHashFromTorrent(torrent), expected)
})

test('surrounding keys do not affect the info hash', () => {
  const torrent = Buffer.concat([
    Buffer.from('d1:a1:b4:info'),
    INFO_DICT,
    Buffer.from('e')
  ])
  const expected = createHash('sha1').update(INFO_DICT).digest('hex')
  assert.equal(infoHashFromTorrent(torrent), expected)
})

test('malformed torrent data returns null instead of throwing', () => {
  assert.equal(infoHashFromTorrent(Buffer.from('not a torrent')), null)
  assert.equal(infoHashFromTorrent(Buffer.from('d4:info')), null)
  assert.equal(infoHashFromTorrent(Buffer.from('d4:info5:abce')), null)
})
