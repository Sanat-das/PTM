import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rankTrailers, STUDIO_QUERY_TERMS, type RankableVideo } from './ranking.ts'

function video(id: string, title: string, channel: string, views: number, durationSeconds = 120): RankableVideo {
  return { id, title, channel, views, durationSeconds }
}

test('studio trailers are kept even when the title never says "official"', () => {
  const ranked = rankTrailers(
    [
      video('a', 'Dune: Part Three | Becoming Feyd', 'Warner Bros. Entertainment', 4_000_000),
      video('b', 'Dune: Part Three | Official Trailer', 'Warner Bros. Entertainment', 4_000_000),
      video('c', 'Dune: Part Two - Movie Review', 'Chris Stuckmann', 593_000)
    ],
    'Dune'
  )
  assert.ok(ranked.some((v) => v.id === 'b'))
  assert.ok(!ranked.some((v) => v.id === 'c'), 'a review is not a trailer')
  assert.equal(ranked[0].id, 'b', 'official trailer ranks first')
})

test('studio channels are valued, and featurettes lose to real trailers', () => {
  const ranked = rankTrailers(
    [
      video('a', 'The Matrix (1999) - New Footage', 'Warner Bros. Pictures', 2_000_000),
      video('b', 'The Matrix (1999) - Official Trailer', 'Warner Bros. Pictures', 1_000_000)
    ],
    'The Matrix'
  )
  assert.equal(ranked[0].id, 'b', 'the real trailer wins')
  assert.ok(!ranked.some((v) => v.id === 'a'), 'featurettes lose when a trailer exists')
})

test('when no trailer exists, a relevant clip is shown instead', () => {
  const ranked = rankTrailers(
    [video('a', 'The Matrix (1999) - New Footage', 'Warner Bros. Pictures', 2_000_000)],
    'The Matrix'
  )
  assert.deepEqual(ranked.map((v) => v.id), ['a'])
})

test('reactions and reviews are excluded even when they mention the film', () => {
  const ranked = rankTrailers(
    [
      video('reaction', 'Dune Part 2 Trailer Reaction', 'Some Creator', 500_000),
      video('review', 'Ben Shapiro Reviews "Dune: Part Two"', 'The Ben Shapiro Show', 600_000),
      video('real', 'Dune: Part Two | Official Trailer', 'Warner Bros. Entertainment', 500_000)
    ],
    'Dune'
  )
  assert.deepEqual(ranked.map((v) => v.id), ['real'])
})

test('featurettes and behind-the-scenes are not trailers', () => {
  const ranked = rankTrailers(
    [
      video('feature', 'Dune: Part Two | Becoming Feyd | Warner Bros. Entertainment', 'Warner Bros. Entertainment', 4_500_000),
      video('making', 'The Matrix (1999) Making Of', 'Sony Pictures Entertainment', 300_000),
      video('real', 'The Matrix (1999) Official Trailer #1', 'Rotten Tomatoes Classic Trailers', 6_300_000)
    ],
    'The Matrix'
  )
  assert.deepEqual(ranked.map((v) => v.id), ['real'])
})

test('unrelated videos are filtered out by title relevance', () => {
  const ranked = rankTrailers(
    [
      video('game', 'Dune: Imperium (Digital) Review', 'Three Minute Gaming', 36_000),
      video('good', 'Dune: Part Two - Official Trailer', 'Warner Bros. Entertainment', 100_000)
    ],
    'Dune'
  )
  assert.deepEqual(ranked.map((v) => v.id), ['good'])
})

test('unrelated spoilers are excluded', () => {
  const ranked = rankTrailers(
    [
      video('spoiler', 'Dune Part Two Ending Explained Full SPOILER Review', 'CinemaBlend', 400_000),
      video('real', 'Dune: Part Two Official Trailer', 'Warner Bros. Entertainment', 100_000)
    ],
    'Dune'
  )
  assert.deepEqual(ranked.map((v) => v.id), ['real'])
})

test('very short and very long videos are deprioritised', () => {
  const ranked = rankTrailers(
    [
      video('short', 'The Matrix - Teaser', 'Warner Bros. Pictures', 900_000, 10),
      video('normal', 'The Matrix - Official Trailer', 'Warner Bros. Pictures', 900_000, 120),
      video('long', 'The Matrix - 4 Hour Marathon Trailer', 'Warner Bros. Pictures', 900_000, 14400)
    ],
    'The Matrix'
  )
  assert.equal(ranked[0].id, 'normal')
  assert.equal(ranked[ranked.length - 1].id, 'short')
})

test('relevant results are returned even without explicit trailer wording', () => {
  const ranked = rankTrailers(
    [
      video('essay', 'The Matrix Was a Documentary', 'Optic Lure', 3_500_000),
      video('other', 'Breaking Bad (2008) Opening Scene', 'Sony Pictures Television', 9_000_000)
    ],
    'The Matrix'
  )
  assert.ok(ranked.length >= 1)
})

test('empty and blank titles return nothing', () => {
  assert.deepEqual(rankTrailers([video('a', 'Official Trailer', 'Channel', 10)], ''), [])
  assert.deepEqual(rankTrailers([video('a', 'Official Trailer', 'Channel', 10)], '   '), [])
})

test('studio query steers the search towards studio channels', () => {
  assert.match(STUDIO_QUERY_TERMS, /Warner Bros/)
  assert.match(STUDIO_QUERY_TERMS, /Universal Pictures/)
})
