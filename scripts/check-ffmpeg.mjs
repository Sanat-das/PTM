/**
 * Preflight for `npm run dist`: electron-builder packs whatever is in
 * node_modules, so if the ffmpeg binary was never downloaded (npm blocks
 * postinstall by default) the packaged app builds fine and fails only at
 * transcode time. Fail the build here instead.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let ffmpegPath
try {
  ffmpegPath = require('ffmpeg-static')
} catch {
  console.error(
    '\n[predist] ffmpeg-static is not installed. Run:\n  npm install && node node_modules/ffmpeg-static/install.js\n'
  )
  process.exit(1)
}

if (typeof ffmpegPath !== 'string' || !existsSync(ffmpegPath)) {
  console.error(
    `\n[predist] ffmpeg binary not found at ${ffmpegPath ?? '(unknown)'}.\n` +
      'Download it first:\n  node node_modules/ffmpeg-static/install.js\n'
  )
  process.exit(1)
}

console.log(`[predist] ffmpeg binary present: ${ffmpegPath}`)
