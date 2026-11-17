import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyFilters, facetCounts, formatBytes, formatDuration } from './filters.ts'
import { parseRelease, themeFromCategory, themeFromName } from './release.ts'
import { DEFAULT_FILTERS, type TorrentResult } from './types.ts'

function makeResult(overrides: Partial<TorrentResult> = {}): TorrentResult {
  const name = overrides.name ?? 'The Matrix (1999) 1080p BluRay x264'
  return {
    id: 'apibay:1',
    provider: 'apibay',
    providerLabel: 'The Pirate Bay',
    name,
    magnet: 'magnet:?xt=urn:btih:abc',
    infoHash: 'abc',
    size: 8_000_000_000,
    seeders: 100,
    leechers: 10,
    category: '201',
    theme: 'movies',
    addedAt: Math.floor(Date.now() / 1000) - 3600,
    release: parseRelease(name),
    ...overrides
  }
}

test('default filters keep every result', () => {
  const results = [makeResult(), makeResult({ seeders: 0 })]
  const filtered = applyFilters(results, { ...DEFAULT_FILTERS })
  assert.equal(filtered.length, 2, 'default filters must not drop anything')
})

test('a result with an age is not dropped when no age limit is set', () => {
  const result = makeResult({ addedAt: 1 })
  const filtered = applyFilters([result], { ...DEFAULT_FILTERS, maxAgeDays: 0 })
  assert.equal(filtered.length, 1)
})

test('age limit removes old results', () => {
  const old = makeResult({ addedAt: Math.floor(Date.now() / 1000) - 40 * 86400 })
  const fresh = makeResult({ addedAt: Math.floor(Date.now() / 1000) - 60 })
  const filtered = applyFilters([old, fresh], { ...DEFAULT_FILTERS, maxAgeDays: 7 })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].id, fresh.id)
})

test('theme filter narrows results', () => {
  const movie = makeResult()
  const anime = makeResult({ theme: 'anime', name: '[Sub] Naruto 01 [1080p]' })
  const filtered = applyFilters([movie, anime], { ...DEFAULT_FILTERS, themes: ['anime'] })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].theme, 'anime')
})

test('size limit applies', () => {
  const big = makeResult({ size: 20 * 1024 ** 3 })
  const small = makeResult({ size: 2 * 1024 ** 3 })
  const filtered = applyFilters([big, small], { ...DEFAULT_FILTERS, maxSizeGb: 4 })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].size, small.size)
})

test('hideDead removes seedless results', () => {
  const dead = makeResult({ seeders: 0 })
  const alive = makeResult({ seeders: 5 })
  const filtered = applyFilters([dead, alive], { ...DEFAULT_FILTERS, hideDead: true })
  assert.equal(filtered.length, 1)
})

test('sort by seeders orders descending', () => {
  const a = makeResult({ seeders: 5 })
  const b = makeResult({ seeders: 50 })
  const filtered = applyFilters([a, b], { ...DEFAULT_FILTERS, sort: 'seeders' })
  assert.equal(filtered[0].seeders, 50)
})

test('release parser strips the file size from the title', () => {
  const parsed = parseRelease('The Matrix (1999) 1080p BrRip x264 - 1.85GB - YIFY')
  assert.equal(parsed.title, 'The Matrix')
  assert.equal(parsed.year, 1999)
  assert.equal(parsed.group, 'YIFY')
  assert.equal(parsed.resolution, '1080p')
  assert.equal(parsed.source, 'BRRip')
  assert.equal(parsed.codec, 'x264')
})

test('release parser extracts quality metadata', () => {
  const parsed = parseRelease('The.Matrix.1999.1080p.BluRay.x264-GROUP')
  assert.equal(parsed.year, 1999)
  assert.equal(parsed.resolution, '1080p')
  assert.equal(parsed.source, 'BluRay')
  assert.equal(parsed.codec, 'x264')
  assert.equal(parsed.group, 'GROUP')
  assert.ok(parsed.title.toLowerCase().includes('matrix'))
})

test('release parser handles season packs', () => {
  const packed = parseRelease('Breaking Bad (2008) Season 3 S03 + Extras (1080p BluRay x265 HEVC 1)')
  assert.equal(packed.title, 'Breaking Bad')
  assert.equal(packed.year, 2008)
  assert.equal(packed.resolution, '1080p')
  assert.equal(packed.source, 'BluRay')
  assert.equal(packed.codec, 'x265')
  assert.equal(themeFromName('Breaking Bad (2008) Season 3 S03 + Extras (1080p BluRay x265 HEVC 1)'), 'tv')

  const complete = parseRelease('Breaking Bad Season 1 Complete 720p.BRRip.Sujaidr (pimprg)')
  assert.equal(complete.group, 'pimprg')
  assert.equal(complete.title, 'Breaking Bad Sujaidr')
  assert.equal(themeFromName('Breaking Bad Season 1 Complete 720p.BRRip.Sujaidr (pimprg)'), 'tv')
})

test('release parser keeps real title words', () => {
  const dune = parseRelease('Dune Part Two 2024 2160p UHD BluRay x265 HDR10+ Atmos-GRP')
  assert.equal(dune.title, 'Dune Part Two')
  assert.equal(dune.year, 2024)
  assert.equal(dune.resolution, '2160p')
  assert.equal(dune.hdr, true)

  const elCamino = parseRelease('El Camino A Breaking Bad Movie (2019) [1080p] [WEBRip]')
  assert.equal(elCamino.title, 'El Camino A Breaking Bad Movie')
  assert.equal(elCamino.year, 2019)
})

test('release parser strips codec and audio noise', () => {
  const got = parseRelease('Game.of.Thrones.S08.COMPLETE.1080p.WEB-DL.DDP5.1.H.264-NTb')
  assert.equal(got.title, 'Game of Thrones')
  assert.equal(got.source, 'WEB-DL')
  assert.equal(got.codec, 'x264')
  assert.equal(got.group, 'NTb')

  const arcane = parseRelease('Arcane S01E03 2160p WEB-DL DDP5.1 Atmos DV HEVC-NTb')
  assert.equal(arcane.title, 'Arcane')
  assert.equal(arcane.season, 1)
  assert.equal(arcane.episode, 3)
})

test('release parser detects anime', () => {
  const parsed = parseRelease('[Erai-raws] One Piece - 1050 [1080p][Multiple Subtitle][Censored]')
  assert.equal(parsed.isAnime, true)
  assert.equal(parsed.title, 'One Piece')
  assert.equal(parsed.resolution, '1080p')
  assert.equal(themeFromName('[Erai-raws] One Piece - 1050 [1080p][Multiple Subtitle][Censored]'), 'anime')
})

test('release parser detects tv episodes', () => {
  const parsed = parseRelease('Breaking.Bad.S01E02.1080p.WEB-DL.x264')
  assert.equal(parsed.season, 1)
  assert.equal(parsed.episode, 2)
  assert.equal(parsed.source, 'WEB-DL')
  assert.equal(themeFromName('Breaking.Bad.S01E02.1080p.WEB-DL.x264'), 'tv')
})

test('facet counts summarise the result set', () => {
  const facets = facetCounts([
    makeResult(),
    makeResult({ theme: 'anime' }),
    makeResult({ theme: 'anime' })
  ])
  assert.equal(facets.themes.find((f) => f.value === 'anime')?.count, 2)
})

test('remux wins over bluray and leaves no tech tokens in the title', () => {
  const parsed = parseRelease('Dune.Part.Two.2024.2160p.BluRay.REMUX.DV.HDR.DTS-HD.MA.7.1-GROUP')
  assert.equal(parsed.source, 'REMUX')
  assert.equal(parsed.resolution, '2160p')
  assert.equal(parsed.title, 'Dune Part Two')
  assert.equal(parsed.year, 2024)
  assert.equal(parsed.group, 'GROUP')
})

test('dubbed release group tags no longer classify as anime', () => {
  const dubbed = parseRelease('Dune.Part.Two.2024.1080p.BluRay.DUBBED.x264-GROUP')
  assert.equal(dubbed.isAnime, false)
  assert.equal(themeFromName('Dune.Part.Two.2024.1080p.BluRay.DUBBED.x264-GROUP', dubbed), 'movies')

  const groupTag = parseRelease('The.Matrix.1999.1080p.BluRay.x264-[PublicHD]')
  assert.equal(groupTag.isAnime, false)
})

test('"complete" alone does not make a box set a tv show', () => {
  const name = 'The Complete Matrix Trilogy 1080p BluRay x264-GROUP'
  assert.equal(themeFromName(name, parseRelease(name)), 'movies')
})

test('hyphenated titles keep their full name', () => {
  const parsed = parseRelease('Spider-Man 2002 1080p BluRay x264-GROUP')
  assert.ok(parsed.title.toLowerCase().startsWith('spider man'))
  assert.equal(parsed.group, 'GROUP')
})

test('pirate bay category numbers map to the right themes', () => {
  assert.equal(themeFromCategory('102'), 'books')
  assert.equal(themeFromCategory('203'), 'music')
  assert.equal(themeFromCategory('205'), 'tv')
  assert.equal(themeFromCategory('208'), 'tv')
  assert.equal(themeFromCategory('209'), 'movies')
})

test('formatters', () => {
  assert.equal(formatBytes(1024 * 1024 * 2.5), '2.5 MB')
  assert.equal(formatDuration(3661), '1:01:01')
  assert.equal(formatDuration(61), '1:01')
})
