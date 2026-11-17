import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRelease } from '../../shared/release.ts'
import type { TorrentResult } from '../../shared/types.ts'
import { dedupe } from './dedupe.ts'

function makeResult(name: string, overrides: Partial<TorrentResult> = {}): TorrentResult {
  return {
    id: `test:${name}:${overrides.providerLabel ?? ''}`,
    provider: 'test',
    providerLabel: 'Test',
    name,
    magnet: undefined,
    infoHash: undefined,
    size: 4_000_000_000,
    seeders: 10,
    leechers: 1,
    category: '201',
    theme: 'movies',
    release: parseRelease(name),
    ...overrides
  }
}

test('same info hash merges into one row, keeping the higher seeder count', () => {
  const a = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: 'abc123',
    seeders: 50,
    providerLabel: 'The Pirate Bay'
  })
  const b = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: 'ABC123',
    seeders: 200,
    providerLabel: '1337x'
  })
  const merged = dedupe([a, b])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 200)
  assert.equal(merged[0].providerLabel, '1337x, The Pirate Bay')
})

test('hash merge fills in a magnet the winning row was missing', () => {
  const hashedNoMagnet = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: 'abc123',
    seeders: 500
  })
  const withMagnet = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: 'abc123',
    seeders: 5,
    magnet: 'magnet:?xt=urn:btih:abc123'
  })
  const merged = dedupe([hashedNoMagnet, withMagnet])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].magnet, 'magnet:?xt=urn:btih:abc123')
})

test('a hashless 1337x row merges with the hashed copy of the same release', () => {
  const tpb = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: 'abc123',
    magnet: 'magnet:?xt=urn:btih:abc123',
    seeders: 300,
    providerLabel: 'The Pirate Bay'
  })
  const leet = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    url: 'https://1337x.to/torrent/1/the-matrix',
    seeders: 120,
    providerLabel: '1337x'
  })
  const merged = dedupe([tpb, leet])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].infoHash, 'abc123')
  assert.equal(merged[0].seeders, 300)
  assert.equal(merged[0].url, 'https://1337x.to/torrent/1/the-matrix')
  assert.equal(merged[0].providerLabel, 'The Pirate Bay, 1337x')
})

test('a YTS-style name merges with the scene-style name of the same movie', () => {
  const yts = makeResult('The Matrix (1999) [bluray] [1080p] [x264]', {
    infoHash: 'def456',
    seeders: 800,
    providerLabel: 'YTS'
  })
  const tpb = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS', {
    infoHash: undefined,
    seeders: 100,
    providerLabel: 'The Pirate Bay'
  })
  const merged = dedupe([yts, tpb])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 800)
})

test('different episodes of the same show are not merged', () => {
  const first = makeResult('Some.Show.S01E02.1080p.WEB-DL.x264-ABC')
  const second = makeResult('Some.Show.S01E03.1080p.WEB-DL.x264-ABC')
  assert.equal(dedupe([first, second]).length, 2)
})

test('anime episodes via "- NN [" are not merged', () => {
  const first = makeResult('[SubsPlease] Show - 01 (1080p).mkv')
  const second = makeResult('[SubsPlease] Show - 02 (1080p).mkv')
  assert.equal(dedupe([first, second]).length, 2)
})

test('same episode from different release groups is merged', () => {
  const a = makeResult('[SubsPlease] Show - 01 (1080p).mkv', { seeders: 10 })
  const b = makeResult('[Erai-raws] Show - 01 (1080p).mkv', { seeders: 40 })
  const merged = dedupe([a, b])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 40)
})

test('different resolutions of the same title are not merged', () => {
  const hd = makeResult('The.Matrix.1999.720p.BluRay.x264-ROVERS')
  const fhd = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS')
  assert.equal(dedupe([hd, fhd]).length, 2)
})

test('different sources of the same title are not merged', () => {
  const web = makeResult('The.Matrix.1999.1080p.WEB-DL.x264-ROVERS')
  const disc = makeResult('The.Matrix.1999.1080p.BluRay.x264-ROVERS')
  assert.equal(dedupe([web, disc]).length, 2)
})

test('the same release from two providers merges even when both have hashes', () => {
  const a = makeResult('Some.Show.S01E02.1080p.WEB-DL.x264-ABC', {
    infoHash: 'aaa111',
    providerLabel: 'Nyaa',
    seeders: 30
  })
  const b = makeResult('Some.Show.S01E02.1080p.WEB-DL.x264-ABC', {
    infoHash: 'bbb222',
    providerLabel: '1337x',
    seeders: 90
  })
  const merged = dedupe([a, b])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 90)
})
