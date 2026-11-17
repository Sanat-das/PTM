/**
 * Subtitles are served to a `<track>` element, which only understands WebVTT.
 * SRT is the common format inside torrents, so convert it here.
 */
export function toVtt(input: string): string | null {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return null

  if (/^WEBVTT/.test(text.trimStart())) {
    return text.trimStart()
  }

  // MicroDVD / ASS cannot be represented without a full parser.
  if (
    /^\{\d+\}\{\d+\}/.test(text) ||
    /^\s*\[Script Info\]/im.test(text) ||
    /^\s*Dialogue:/im.test(text)
  ) {
    return null
  }

  const lines = text.split('\n')
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    // Drop SRT cue numbers (the next line is the timing line); WebVTT does not
    // need them.
    if (/^\d+$/.test(line.trim()) && /-->/.test(lines[index + 1] ?? '')) continue

    output.push(
      line
        // 00:00:01,000 --> 00:00:04,000
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        // VTT only supports a small HTML subset.
        .replace(/<\/?font[^>]*>/gi, '')
        .replace(/\{\\[^}]*\}/g, '')
    )
  }

  const body = output.join('\n').trim()
  if (!body) return null
  return `WEBVTT\n\n${body}\n`
}
