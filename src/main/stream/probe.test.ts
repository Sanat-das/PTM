import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAudioTracks } from './probe.ts'

const FFMPEG_OUTPUT = `
Input #0, matroska,webm, from 'file:///sample.mkv':
  Duration: 01:42:00.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, SAR 1:1 DAR 16:9, 23.98 fps, 23.98 tbr, 1k tbn (default)
  Stream #0:1(jpn): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
    Metadata:
      title           : Main track
      default         : 1
  Stream #0:2(eng): Audio: ac3 (AC-3 / 0x332D4341), 48000 Hz, 5.1(side), 640 kb/s
    Metadata:
      title           : English
  Stream #0:3: Subtitle: ass (ssa / 0x20737361) (default)
`

test('parses audio streams with language, channels and defaults', () => {
  const tracks = parseAudioTracks(FFMPEG_OUTPUT)
  assert.equal(tracks.length, 2)

  assert.deepEqual(tracks[0], {
    index: 0,
    language: 'jpn',
    title: 'Main track',
    codec: 'aac',
    channels: 2,
    isDefault: true
  })

  assert.deepEqual(tracks[1], {
    index: 1,
    language: 'eng',
    title: 'English',
    codec: 'ac3',
    channels: 6,
    isDefault: false
  })
})

test('falls back to metadata language and treats unknown as untagged', () => {
  const output = `
  Stream #0:0: Audio: dts (DTS), 48000 Hz, 5.1, 1536 kb/s
    Metadata:
      language        : eng
      title           : Commentary
  Stream #0:1: Audio: aac (LC), 44100 Hz, mono, 64 kb/s
    Metadata:
      language        : und
`
  const tracks = parseAudioTracks(output)
  assert.equal(tracks.length, 2)
  assert.equal(tracks[0].language, 'eng')
  assert.equal(tracks[0].channels, 6)
  assert.equal(tracks[1].language, undefined)
  assert.equal(tracks[1].channels, 1)
})

test('returns an empty list when nothing parses', () => {
  assert.deepEqual(parseAudioTracks(''), [])
  assert.deepEqual(parseAudioTracks('Stream #0:0: Video: h264'), [])
})
