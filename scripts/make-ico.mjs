/**
 * Wraps a PNG into a Windows ICO container (PNG-compressed 256x256 icon,
 * the only kind Vista+ needs). Usage: node scripts/make-ico.mjs <in.png> <out.ico>
 */
import fs from 'node:fs'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: node scripts/make-ico.mjs <in.png> <out.ico>')
  process.exit(1)
}

const png = fs.readFileSync(inPath)
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('input is not a PNG')

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // image count

const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // width: 0 means 256
entry.writeUInt8(0, 1) // height: 0 means 256
entry.writeUInt8(0, 2) // colors in palette (0 = truecolor)
entry.writeUInt8(0, 3) // reserved
entry.writeUInt16LE(1, 4) // color planes
entry.writeUInt16LE(32, 6) // bits per pixel
entry.writeUInt32LE(png.length, 8) // payload size
entry.writeUInt32LE(22, 12) // payload offset (6 header + 16 entry)

fs.writeFileSync(outPath, Buffer.concat([header, entry, png]))
console.log('[make-ico] wrote', outPath, `(${png.length} bytes PNG payload)`)
