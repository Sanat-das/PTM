import type { Codec, ReleaseInfo, Resolution, Source, Theme } from './types.ts'

/**
 * Best-effort parser for scene release names.
 * Goal: pull out enough to filter by theme/quality without being strict about it.
 */

const RESOLUTION_PATTERNS: Array<[RegExp, Resolution]> = [
  [/\b(4320p|2160[pi]|4k|uhd)\b/i, '2160p'],
  [/\b1440[pi]\b/i, '1440p'],
  [/\b(1080[pi]|1080i|fhd)\b/i, '1080p'],
  [/\b720[pi]\b/i, '720p'],
  [/\b(480[pi]|sd)\b/i, '480p'],
  [/\b360[pi]\b/i, '360p']
]

const SOURCE_PATTERNS: Array<[RegExp, Source]> = [
  // REMUX wins over BluRay: "BluRay.REMUX" describes the same disc, untouched.
  [/\bremux\b/i, 'REMUX'],
  [/\bblu-?ray\b/i, 'BluRay'],
  [/\bbd-?rip\b/i, 'BDRip'],
  [/\bbr-?rip\b/i, 'BRRip'],
  [/\bweb-?dl\b/i, 'WEB-DL'],
  [/\bweb-?rip\b|\bwebrip\b/i, 'WEBRip'],
  [/\bhd-?rip\b/i, 'HDRip'],
  [/\bhd-?tv\b/i, 'HDTV'],
  [/\bdvd-?rip\b/i, 'DVDRip'],
  [/\bcam-?rip\b|\bcam\b/i, 'CAM'],
  [/\bts\b/i, 'TS'],
  [/\bsat-?rip\b/i, 'SATRip']
]

const CODEC_PATTERNS: Array<[RegExp, Codec]> = [
  [/\b(x265|h\.?265|hevc)\b/i, 'x265'],
  [/\b(x264|h\.?264|avc)\b/i, 'x264'],
  [/\bav1\b/i, 'AV1'],
  [/\bxvid\b/i, 'XviD'],
  [/\bdivx\b/i, 'DivX'],
  [/\bmpeg-?2\b/i, 'MPEG2']
]

const AUDIO_TOKENS =
  /\b(ddp?\+?(?:5\.1|7\.1)?|dd\+?(?:5\.1|7\.1)?|ddp|eac3|dd\+|ac-?3|dts-?hd|dts|true-?hd|atmos|aac(?:\s?\d\.\d)?|flac|opus|mp3|lpcm|pcm)\b/gi

const EDITION_TOKENS =
  /\b(extended|unrated|remastered|directors?\s?cut|director'?s\s?cut|theatrical|imdb|proper|repack|criterion|anniversary)\b/gi

const NOISE =
  /\b(german|french|spanish|italian|russian|japanese|korean|chinese|hindi|portuguese|tamil|telugu|dubbed|subbed|multi(?:ple)?|dual|subs?|dub|retail|internal|readnfo|proof|limited|uncut|subtitle(s)?|censored|uncensored|eng|ita|rus|jpn|ger|fre|spa|por|chi|kor|hin|ara|nordic|nordic|eng-?ita|eng-?rus)\b/gi

/** Tokens that belong to the technical part of a release name. */
const TECH_NOISE =
  /\b(\d{3,4}[pi]|4k|uhd|hdr10?|hdr|dv|dolby\s?vision|sdr|10bit|8bit|hi10p|remux|web-?dl|web-?rip|blu-?ray|bd-?rip|br-?rip|hd-?rip|hd-?tv|dvd-?rip|cam|hdts|dvdscr|x26[45]|h26[45]|hevc|hev|avc|av1|xvid|divx|mpeg-?2|aac\d?(?:\.\d)?|ac-?3|ec-?3|eac3|dts(?:[- ]?hd)?(?:\s?ma)?|dts[- ]?x|true-?hd|atmos|flac|mp3|3d|hsbs|sbs|hou|imax|complete|extras?|bonus|specials|batch)\b/gi

/** Structural markers that are never part of a title. */
const STRUCTURE = /\b(season|series|complete|completed|extras?|bonus|specials?|batch|collection|episode|episodes)\b/gi

function matchFrom<T>(patterns: Array<[RegExp, T]>, text: string, fallback: T): T {
  for (const [re, value] of patterns) {
    if (re.test(text)) return value
  }
  return fallback
}

function isTechnicalToken(token: string): boolean {
  TECH_NOISE.lastIndex = 0
  const technical = TECH_NOISE.test(token)
  TECH_NOISE.lastIndex = 0
  return technical
}

function isNoiseToken(token: string): boolean {
  NOISE.lastIndex = 0
  const noise = NOISE.test(token)
  NOISE.lastIndex = 0
  return noise
}

/**
 * Pulls the release group out of the tail of a name. Handles both the
 * `-GROUP` and the `(group)` conventions.
 */
function extractGroup(name: string): { group?: string; rest: string } {
  const dashed = name.match(/[-–—]\s*([A-Za-z0-9_.]{2,20})\s*$/)
  if (dashed) {
    const group = dashed[1]
    const rest = name.slice(0, dashed.index).trim()
    // "Spider-Man" is a title, not group "Man": only treat the tail as a group
    // when the rest still reads like a release name.
    const releaseLike = rest.includes(' ') || /^[A-Z0-9_.]{2,}$/.test(group)
    if (
      rest.length >= 3 &&
      releaseLike &&
      !/^\d+(\.\d+)?\s*(gb|mb)$/i.test(group) &&
      !/^(?:19|20)\d{2}$/.test(group) &&
      !isTechnicalToken(group)
    ) {
      return { group, rest }
    }
  }

  const parenthesised = name.match(/\(\s*([A-Za-z0-9_.]{2,20})\s*\)\s*$/)
  if (parenthesised) {
    const group = parenthesised[1]
    if (!isTechnicalToken(group) && !isNoiseToken(group) && !/^(?:19|20)\d{2}$/.test(group)) {
      return { group, rest: name.slice(0, parenthesised.index).trim() }
    }
  }

  // "[PublicHD]" style groups. Bracketed quality tags (`[1080p]`) are rejected
  // by the technical check.
  const bracketed = name.match(/\[\s*([A-Za-z0-9_.]{2,20})\s*\]\s*$/)
  if (bracketed) {
    const group = bracketed[1]
    const rest = name.slice(0, bracketed.index).trim()
    if (
      rest.length >= 3 &&
      !isTechnicalToken(group) &&
      !isNoiseToken(group) &&
      !/^(?:19|20)\d{2}$/.test(group)
    ) {
      return { group, rest }
    }
  }

  return { rest: name }
}

function detectAnime(name: string): boolean {
  // "[Group] Show - 12 [1080p]" is the anime convention. A leading bracket that
  // looks like a year, or a western group tag such as "[PublicHD]", is not.
  const lead = name.match(/^\[([^\]]+)\]/)
  if (lead) {
    const tag = lead[1].trim()
    if (tag.length > 0 && !/\b(?:19|20)\d{2}\b/.test(tag) && !/^(?:publichd|rarbg|ettv|eztv)$/i.test(tag)) {
      return true
    }
  }
  if (/\banime\b/i.test(name)) return true
  // "Show Name - 12 [1080p]": episode number outside an SxxExx pattern.
  return / - \d{1,3}(?:v\d)? \[/.test(name)
}

export function parseRelease(rawName: string): ReleaseInfo {
  let name = rawName.replace(/\.(mkv|mp4|avi|mov|ts|m4v|wmv|flv|webm|m2ts)$/i, '').trim()

  // Pre-pass while dots still separate tokens: "H.264" and "DDP5.1" would
  // otherwise become "H 264" and "DDP5 1" and leak into the title.
  name = name.replace(/\b\d+(?:[.,]\d+)?\s?(?:GB|MB|TB|GiB|MiB|TiB)\b/gi, ' ')
  name = name.replace(/\b[dh]\.?26([45])\b/gi, 'x26$1')
  name = name.replace(/\bddp?\+?\d(?:[.,]\d)?\b/gi, ' ')
  name = name.replace(/\b[57]\.1\b/g, ' ')
  name = name.replace(/\b(?:hevc|x26[45])\s*1\b/gi, ' ')
  name = name.replace(/\b(?:10|8)\s?bit\b/gi, ' ')

  name = name.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()

  const resolution = matchFrom(RESOLUTION_PATTERNS, name, 'unknown')
  const source = matchFrom(SOURCE_PATTERNS, name, 'unknown')
  const codec = matchFrom(CODEC_PATTERNS, name, 'unknown')

  const rangeMatch = name.match(/\(?\b((?:19|20)\d{2})\s*[-–]\s*(?:19|20)\d{2}\)?/)
  const yearMatch = name.match(/(?:^|[\s(\[])((?:19|20)\d{2})(?:[\s)\]]|$)/)
  const year = yearMatch
    ? Number(yearMatch[1])
    : rangeMatch
      ? Number(rangeMatch[1])
      : undefined

  const seMatch = name.match(/\bS(\d{1,2})E(\d{1,3})\b/i)
  const season = seMatch ? Number(seMatch[1]) : undefined
  const episode = seMatch ? Number(seMatch[2]) : undefined

  const audioMatch = name.match(AUDIO_TOKENS)
  const editionMatch = name.match(EDITION_TOKENS)

  const is3d = /\b(3d|hsbs|sbs|hou)\b/i.test(name)
  const hdr = /\b(hdr10?|hdr)\b/i.test(name) || /\bdolby\s?vision\b/i.test(name)
  const proper = /\bproper\b/i.test(name)
  const repack = /\brepack\b/i.test(name)
  const isAnime = detectAnime(name)

  const { group, rest } = extractGroup(name)

  // Build a clean title: drop everything technical, keep the human part.
  let working = rest
  working = working.replace(/^\[[^\]]+\]\s*/, '')
  working = working.replace(/\(?\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\)?/g, ' ')
  working = working.replace(/\((?:19|20)\d{2}\)/g, ' ')
  working = working.replace(/\bS\d{1,2}E\d{1,3}\b/gi, ' ')
  working = working.replace(/\bseason\s*\d{1,3}\b/gi, ' ')
  working = working.replace(/\bs\d{1,2}(?!e\d)\b/gi, ' ')
  working = working.replace(/[-–—]\s*\d{1,4}(?:v\d)?(?=\s*\[|$)/g, ' ')
  working = working.replace(TECH_NOISE, ' ')
  working = working.replace(STRUCTURE, ' ')
  working = working.replace(NOISE, ' ')
  working = working.replace(/\bs\d{1,2}(?!e\d)\b/gi, ' ')
  working = working.replace(/[[\](){}]/g, ' ')
  working = working.replace(/[-–—+]+/g, ' ')
  working = working.replace(/\b(and|&|vs)\b/gi, ' ')
  working = working.replace(/\s+/g, ' ').trim()

  // A bare year is metadata, not part of the title — unless it is all we have.
  if (working && !/^\d{4}$/.test(working)) {
    const withoutYear = working.replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim()
    if (withoutYear) working = withoutYear
  }

  // Leftovers like "1" from a stray tag.
  working = working.replace(/\s+\d{1,2}$/, '')

  const title = working.length > 0 ? working : rawName

  return {
    title,
    year,
    resolution,
    source,
    codec,
    audio: audioMatch ? audioMatch[0].toUpperCase() : undefined,
    group,
    season,
    episode,
    is3d,
    hdr,
    proper,
    repack,
    isAnime,
    edition: editionMatch ? editionMatch[0] : undefined
  }
}

/**
 * Theme detection from the release name. Returns a specific theme when the
 * name makes it obvious, otherwise 'movies' as the generic default.
 */
export function themeFromName(name: string, parsed?: ReleaseInfo): Theme {
  const p = parsed ?? parseRelease(name)
  if (p.isAnime) return 'anime'
  if (p.season !== undefined || p.episode !== undefined) return 'tv'
  if (
    /\b(s\d{1,2}e\d{1,3}|season\s*\d+|episode\s*\d+|\d+x\d{2}|s\d{1,2}(?!e\d)|series)\b/i.test(
      name
    )
  ) {
    return 'tv'
  }
  if (/\b(dubbed|subbed|dual|bdrip|bluray|web-?dl|webrip|hdrip|hd-?tv|remux)\b/i.test(name)) {
    return 'movies'
  }
  return 'movies'
}

const TPB_CATEGORY_THEME: Record<string, Theme> = {
  '101': 'music',
  '102': 'books',
  '103': 'music',
  '104': 'music',
  '105': 'music',
  '106': 'music',
  '201': 'movies',
  '202': 'movies',
  '203': 'music',
  '204': 'movies',
  '205': 'tv',
  '206': 'other',
  '207': 'movies',
  '208': 'tv',
  '209': 'movies',
  '301': 'apps',
  '302': 'apps',
  '303': 'apps',
  '304': 'apps',
  '305': 'apps',
  '306': 'apps',
  '307': 'apps',
  '401': 'games',
  '402': 'games',
  '403': 'games',
  '404': 'games',
  '405': 'games',
  '406': 'games',
  '407': 'games',
  '408': 'games',
  '409': 'games',
  '501': 'adult',
  '502': 'adult',
  '503': 'adult',
  '504': 'adult',
  '505': 'adult',
  '506': 'adult',
  '507': 'adult',
  '508': 'adult',
  '509': 'adult',
  '510': 'adult',
  '511': 'adult',
  '601': 'books',
  '602': 'books',
  '603': 'other',
  '604': 'other',
  '605': 'other',
  '606': 'other'
}

export function themeFromCategory(category: string): Theme | undefined {
  return TPB_CATEGORY_THEME[String(category)]
}
