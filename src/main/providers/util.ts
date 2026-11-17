/** "1.4 GiB" / "700 MB" / "1,234,567 bytes" -> bytes */
export function parseSizeToBytes(input: string | number | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  if (!input) return 0

  const text = input.trim().toLowerCase().replace(/,/g, '')
  const match = text.match(/([\d.]+)\s*([kmgt]?i?b|bytes?)?/)
  if (!match) return 0

  const value = Number(match[1])
  if (!Number.isFinite(value)) return 0

  const unit = (match[2] ?? 'b').replace(/bytes?/, 'b')
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4
  }

  return Math.round(value * (multipliers[unit] ?? 1))
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

/**
 * 1337x renders dates like "Aug. 17th '26" / "Sep 1st '24", which Date.parse
 * rejects. Parse them explicitly; everything else falls back to Date.parse.
 */
function parseOrdinalDate(input: string): number | undefined {
  const match = input.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*'(\d{2,4})$/)
  if (!match) return undefined
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()]
  if (month === undefined) return undefined
  let year = Number(match[3])
  if (year < 100) year += year <= 69 ? 2000 : 1900
  const time = Date.UTC(year, month, Number(match[2]))
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000)
}

/** RSS pubDate -> unix seconds */
export function parseRssDate(input: string | undefined): number | undefined {
  if (!input) return undefined
  const ordinal = parseOrdinalDate(input)
  if (ordinal !== undefined) return ordinal
  const parsed = Date.parse(input)
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
}
