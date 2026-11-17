import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toVtt } from './subtitles.ts'

test('SRT is converted to WebVTT timestamps', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    'First line',
    '',
    '2',
    '00:00:05,500 --> 00:00:08,000',
    '<font color="red">Second</font> line'
  ].join('\r\n')

  const vtt = toVtt(srt)
  assert.ok(vtt)
  assert.ok(vtt.startsWith('WEBVTT\n\n'))
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.000'))
  assert.ok(!vtt.includes('00:00:01,000'))
  assert.ok(!vtt.includes('<font'))
  assert.ok(vtt.includes('First line'))
  assert.ok(!/^1$/m.test(vtt), 'SRT cue numbers are dropped')
})

test('an existing WebVTT file is passed through', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n'
  assert.equal(toVtt(vtt), vtt)
})

test('unsupported subtitle formats are rejected', () => {
  assert.equal(toVtt('Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hi'), null)
  assert.equal(toVtt('[Script Info]\nTitle: x'), null)
  assert.equal(toVtt('{100}{200}MicroDVD line'), null)
  assert.equal(toVtt('   '), null)
})
