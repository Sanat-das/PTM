import { createHash } from 'node:crypto'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32ToHex(input: string): string | null {
  let bits = 0
  let value = 0
  let output = ''

  for (const char of input.toLowerCase()) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output += ((value >> bits) & 0xff).toString(16).padStart(2, '0')
    }
  }

  return output.length === 40 ? output : null
}

/** Extracts the info hash from a magnet link as lowercase hex. */
export function infoHashFromMagnet(magnet: string): string | null {
  // Scan all xt=urn:btih: parameters — a magnet whose first btih is malformed
  // may still carry a valid one later.
  for (const match of magnet.matchAll(/xt=urn:btih:([^&\s]+)/gi)) {
    let raw: string
    try {
      raw = decodeURIComponent(match[1]).trim().toLowerCase()
    } catch {
      continue // malformed percent-encoding — try the next xt parameter
    }
    // Base32 values may carry '=' padding; strip it before decoding.
    const unpadded = raw.replace(/=+$/, '')
    if (/^[0-9a-f]{40}$/.test(unpadded)) return unpadded
    const decoded = base32ToHex(unpadded)
    if (decoded) return decoded
  }
  return null
}

/** Adds any configured trackers the magnet does not carry yet. */
export function appendTrackers(magnet: string, trackers: string[]): string {
  if (!magnet.toLowerCase().startsWith('magnet:') || trackers.length === 0) return magnet
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const existing = new Set(
    [...magnet.matchAll(/[?&]tr=([^&]+)/gi)].map((match) => decode(match[1]).toLowerCase())
  )
  const additions: string[] = []
  for (const raw of trackers) {
    const tracker = raw.trim()
    if (!tracker) continue
    const key = tracker.toLowerCase()
    if (existing.has(key)) continue
    existing.add(key)
    additions.push(`tr=${encodeURIComponent(tracker)}`)
  }
  if (additions.length === 0) return magnet
  return `${magnet}${magnet.includes('?') ? '&' : '?'}${additions.join('&')}`
}

/** Reads a bencoded string (`<length>:<bytes>`) starting at `start`. */
function readBencodeString(bytes: Buffer, start: number): { value: string; end: number } {
  let index = start
  let length = 0
  while (bytes[index] >= 0x30 && bytes[index] <= 0x39) {
    length = length * 10 + (bytes[index] - 0x30)
    index += 1
  }
  if (bytes[index] !== 0x3a) throw new Error('Not a bencode string')
  const valueStart = index + 1
  const end = valueStart + length
  if (end > bytes.length) throw new Error('Truncated bencode string')
  return { value: bytes.toString('utf8', valueStart, end), end }
}

/** Returns the byte offset just past the bencoded value starting at `start`. */
function bencodeValueEnd(bytes: Buffer, start: number): number {
  const marker = bytes[start]
  if (marker === 0x69) {
    // i<number>e
    const end = bytes.indexOf(0x65, start)
    if (end === -1) throw new Error('Truncated bencode integer')
    return end + 1
  }
  if (marker === 0x6c) {
    // l<values>e
    let index = start + 1
    while (bytes[index] !== 0x65) index = bencodeValueEnd(bytes, index)
    return index + 1
  }
  if (marker === 0x64) {
    // d<key><value>...e
    let index = start + 1
    while (bytes[index] !== 0x65) {
      const key = readBencodeString(bytes, index)
      index = bencodeValueEnd(bytes, key.end)
    }
    return index + 1
  }
  return readBencodeString(bytes, start).end
}

/**
 * Extracts the info hash from a .torrent file. Only the `info` dictionary is
 * hashed, exactly as BitTorrent defines it.
 */
export function infoHashFromTorrent(bytes: Buffer): string | null {
  try {
    if (bytes[0] !== 0x64) return null
    let index = 1
    while (index < bytes.length && bytes[index] !== 0x65) {
      const key = readBencodeString(bytes, index)
      const end = bencodeValueEnd(bytes, key.end)
      if (key.value === 'info') {
        return createHash('sha1').update(bytes.subarray(key.end, end)).digest('hex')
      }
      index = end
    }
    return null
  } catch {
    return null
  }
}
