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

/** RSS pubDate -> unix seconds */
export function parseRssDate(input: string | undefined): number | undefined {
  if (!input) return undefined
  const parsed = Date.parse(input)
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
}
