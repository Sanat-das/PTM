import { spawn } from 'node:child_process'
import type { AudioTrackInfo } from '../../shared/types.ts'
import { resolveFfmpeg } from './transcode.ts'

/**
 * Runs `ffmpeg -i <url>` and returns the stream table it prints to stderr.
 * ffmpeg has no machine-readable stream dump without ffprobe, which
 * ffmpeg-static does not ship. ffmpeg exits non-zero for `-i` with no output
 * file; that is expected and ignored.
 */
function probeOutput(sourceUrl: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const done = (text: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(text)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(resolveFfmpeg(), ['-hide_banner', '-nostdin', '-i', sourceUrl], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
    } catch (error) {
      console.warn('[probe] spawn failed', (error as Error).message)
      resolve('')
      return
    }

    const timer = setTimeout(() => {
      console.warn('[probe] timed out reading the stream header')
      child.kill()
      done('')
    }, timeoutMs)

    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      // The stream table is printed at the top; keep the HEAD, not the tail.
      if (output.length > 256 * 1024) output = output.slice(0, 256 * 1024)
    })
    child.on('error', (error) => {
      console.warn('[probe] spawn failed', error.message)
      done('')
    })
    // 'close' fires once stdio is fully drained — 'exit' can cut off the tail.
    child.on('close', () => done(output))
  })
}

/** Lists the audio streams of a media file. */
export function probeAudioTracks(
  sourceUrl: string,
  timeoutMs = 20000
): Promise<AudioTrackInfo[]> {
  return probeOutput(sourceUrl, timeoutMs).then(parseAudioTracks)
}

// Codecs HLS can carry without transcoding. Anything else (VP9, AC3, DTS, …)
// has to go through libx264/AAC, which is what made large files wait.
const REMUX_CODECS = new Set(['h264', 'avc1', 'aac', 'mp4a'])
const STREAM_CODEC = /^\s*Stream #\d+:\d+.*?:\s*(Video|Audio):\s*([A-Za-z0-9_.-]+)/

/**
 * True when every video/audio stream can be stream-copied into fMP4 HLS.
 * Subtitle and data streams are ignored: ffmpeg's default mapping excludes
 * them from the HLS output anyway.
 */
export async function probeCanRemux(sourceUrl: string, timeoutMs = 20000): Promise<boolean> {
  const output = await probeOutput(sourceUrl, timeoutMs)
  let hasVideo = false
  let ok = true
  for (const line of output.split('\n')) {
    const match = STREAM_CODEC.exec(line)
    if (!match) continue
    if (match[1] === 'Video') hasVideo = true
    if (!REMUX_CODECS.has(match[2].toLowerCase())) ok = false
  }
  return hasVideo && ok
}

const AUDIO_LINE =
  /^\s*Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([^)]*)\))?[^\n:]*:\s*Audio:\s*([A-Za-z0-9_.-]+)/
const STREAM_LINE = /^\s*Stream #\d+:\d+/
const LANGUAGE_LINE = /^\s*(?:language|lang)\s*:\s*([A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?)\s*$/
const TITLE_LINE = /^\s*title\s*:\s*(.+?)\s*$/

/** Lines after an Audio stream line may carry its `language`/`title` metadata. */
export function parseAudioTracks(output: string): AudioTrackInfo[] {
  const tracks: AudioTrackInfo[] = []
  let current: AudioTrackInfo | null = null

  for (const line of output.split('\n')) {
    const audio = AUDIO_LINE.exec(line)
    if (audio) {
      const language = cleanLanguage(audio[1])
      current = {
        index: tracks.length,
        language,
        codec: audio[2]?.toLowerCase(),
        channels: parseChannels(line),
        isDefault: /\(default\)/.test(line)
      }
      tracks.push(current)
      continue
    }
    if (STREAM_LINE.test(line)) {
      // A different stream type ended the metadata block of the audio one.
      current = null
      continue
    }
    if (!current) continue
    const language = LANGUAGE_LINE.exec(line)
    if (language && !current.language) current.language = cleanLanguage(language[1])
    const title = TITLE_LINE.exec(line)
    if (title && !current.title) current.title = title[1]
    if (/^\s*default\s*:\s*(1|true|yes)/i.test(line)) current.isDefault = true
  }

  return tracks
}

function cleanLanguage(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  const language = tag.trim().toLowerCase()
  if (!language || language === 'und' || language === 'unknown') return undefined
  return language
}

function parseChannels(line: string): number | undefined {
  if (/\bmono\b/i.test(line)) return 1
  if (/\bstereo\b/i.test(line)) return 2
  if (/\b5\.1\b/.test(line)) return 6
  if (/\b7\.1\b/.test(line)) return 8
  const explicit = /(\d+)\s+channels?\b/i.exec(line)
  return explicit ? Number(explicit[1]) : undefined
}
