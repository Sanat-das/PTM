import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Loader2, AlertTriangle, Octagon } from 'lucide-react'
import { api } from '../lib/api.ts'

const LANGUAGE_LABELS: Record<string, string> = {
  eng: 'English',
  en: 'English',
  english: 'English',
  spa: 'Spanish',
  es: 'Spanish',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  ita: 'Italian',
  it: 'Italian',
  rus: 'Russian',
  ru: 'Russian',
  jpn: 'Japanese',
  ja: 'Japanese',
  chi: 'Chinese',
  zh: 'Chinese',
  kor: 'Korean',
  ko: 'Korean',
  por: 'Portuguese',
  pt: 'Portuguese',
  ara: 'Arabic',
  ar: 'Arabic',
  hin: 'Hindi',
  hi: 'Hindi',
  dut: 'Dutch',
  nl: 'Dutch',
  swe: 'Swedish',
  sv: 'Swedish',
  nor: 'Norwegian',
  no: 'Norwegian',
  dan: 'Danish',
  da: 'Danish',
  fin: 'Finnish',
  fi: 'Finnish',
  pol: 'Polish',
  pl: 'Polish',
  tur: 'Turkish',
  tr: 'Turkish',
  gre: 'Greek',
  el: 'Greek',
  heb: 'Hebrew',
  he: 'Hebrew',
  ukr: 'Ukrainian',
  uk: 'Ukrainian',
  cze: 'Czech',
  cs: 'Czech',
  hun: 'Hungarian',
  hu: 'Hungarian',
  rum: 'Romanian',
  ro: 'Romanian',
  vie: 'Vietnamese',
  vi: 'Vietnamese',
  tha: 'Thai',
  th: 'Thai',
  ind: 'Indonesian',
  id: 'Indonesian'
}

function normalizeName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** A subtitle belongs to a video when their names share a long stem. */
function subtitleMatches(videoName: string, subtitleName: string): boolean {
  const video = normalizeName(videoName)
  const subtitle = normalizeName(subtitleName)
  if (!video || !subtitle) return false
  const stem = video.slice(0, 12)
  return subtitle.includes(stem) || video.includes(subtitle.slice(0, 12))
}

function subtitleLabel(name: string): string {
  const tokens = name
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[._\-[\]()\s]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())

  const language = tokens.map((token) => LANGUAGE_LABELS[token]).find(Boolean)
  const flags = ['forced', 'sdh', 'cc', 'hi']
    .filter((flag) => tokens.includes(flag))
    .map((flag) => flag.toUpperCase())

  if (language) return flags.length > 0 ? `${language} (${flags.join(', ')})` : language
  if (flags.length > 0) return `Subtitles (${flags.join(', ')})`
  return 'Subtitles'
}

/** BCP-47-ish tag for the <track srcLang> attribute, from the same tokens. */
function subtitleLang(name: string): string | undefined {
  const tokens = name
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[._\-[\]()\s]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
  return tokens.find((token) => LANGUAGE_LABELS[token])
}

interface PlayerProps {
  sessionId: string
  fileIndex: number
  /** Where to start playback; used when resuming from the library. */
  resumePositionSec?: number
  /** Clean title stored in the library; falls back to the torrent name. */
  title?: string
  /** Optional enrichment stored in the library entry. */
  theme?: import('../../../shared/types.ts').Theme
  imdbId?: string
  onClose: () => void
  onStop?: () => void
}

export function Player({ sessionId, fileIndex, resumePositionSec, title, theme, imdbId, onClose, onStop }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Whether the visibility hook paused the video (so restore can resume it),
  // as opposed to the user pressing pause themselves.
  const autoPausedRef = useRef(false)
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settingsGet(),
    staleTime: Infinity
  })
  const pausePlaybackOnMinimize = settingsQuery.data?.pausePlaybackOnMinimize ?? false
  const [url, setUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<'direct' | 'hls'>('direct')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Preparing stream…')
  const [canForceTranscode, setCanForceTranscode] = useState(false)
  const [subtitles, setSubtitles] = useState<
    Array<{ url: string; label: string; lang?: string }>
  >([])

  // External subtitle files travel with the torrent; expose the usable ones to
  // the video element so the native captions menu can switch them.
  useEffect(() => {
    let cancelled = false
    setSubtitles([])

    void (async () => {
      try {
        const files = await api.torrentFiles(sessionId)
        const video = files[fileIndex]
        const candidates = files.filter(
          (file) => file.isSubtitle && (file.ext === 'srt' || file.ext === 'vtt')
        )
        if (candidates.length === 0) return

        const onlyVideo = files.filter((file) => file.isVideo).length <= 1
        const chosen =
          onlyVideo || !video
            ? candidates
            : candidates.filter((file) => subtitleMatches(video.name, file.name))

        const tracks: Array<{ url: string; label: string; lang?: string } | null> =
          await Promise.all(
            chosen.slice(0, 12).map(async (file) => {
              const url = await api.subtitleUrl(sessionId, file.index)
              return url
                ? { url, label: subtitleLabel(file.name), lang: subtitleLang(file.name) }
                : null
            })
          )
        if (!cancelled) {
          setSubtitles(
            tracks.filter((track): track is { url: string; label: string; lang?: string } => {
              return track !== null
            })
          )
        }
      } catch (error) {
        console.warn('[player] subtitle lookup failed', (error as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, fileIndex])

  // Pause the video when the window is minimized; resume on restore — but
  // only playback the hook itself paused, never something the user paused.
  useEffect(() => {
    if (!pausePlaybackOnMinimize) return
    const video = videoRef.current
    if (!video) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!video.paused) {
          video.pause()
          autoPausedRef.current = true
        }
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false
        void video.play().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pausePlaybackOnMinimize])

  useEffect(() => {
    let cancelled = false

    async function start(forceTranscode: boolean) {
      try {
        setError(null)
        setStatus(forceTranscode ? 'Starting transcoder…' : 'Preparing stream…')
        const target = await api.streamStart({ sessionId, fileIndex, forceTranscode })
        if (cancelled) return

        setMode(target.mode)
        setUrl(target.url)
        setCanForceTranscode(target.mode === 'direct')
        setStatus(target.mode === 'hls' ? 'Buffering from torrent…' : 'Connecting to torrent…')
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }

    void start(false)
    return () => {
      cancelled = true
    }
  }, [sessionId, fileIndex])

  // Attach the stream to the video element once we know the URL.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !url) return

    let hls: import('hls.js').default | null = null
    let cancelled = false

    if (mode === 'hls') {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 60,
            manifestLoadingMaxRetry: 6,
            levelLoadingMaxRetry: 6,
            fragLoadingMaxRetry: 8
          })
          hls.loadSource(url)
          hls.attachMedia(video)

          let retries = 0
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            retries = 0
            setStatus('Buffering from torrent…')
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return
            const code = (data.response as { code?: number } | undefined)?.code

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 8) {
              // 503 means ffmpeg is still probing; other failures may be transient.
              retries += 1
              setStatus(code === 503 ? 'Waiting for the transcoder…' : 'Buffering from torrent…')
              hls?.startLoad()
              return
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls?.recoverMediaError()
              return
            }

            setError(
              code === 502
                ? 'Transcoding failed. The file may be corrupt or unsupported.'
                : `Playback failed: ${data.details}`
            )
            hls?.destroy()
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
        } else {
          setError('HLS playback is not supported in this build')
        }
      })
    } else {
      video.src = url
    }

    const onLoadedMetadata = () => {
      setStatus('Playing')
      if (resumePositionSec && resumePositionSec > 0) {
        video.currentTime = resumePositionSec
      }
    }
    const onCanPlay = () => setStatus('Playing')
    const onWaiting = () => setStatus('Buffering…')
    const onError = () => {
      if (mode === 'direct') {
        setCanForceTranscode(true)
        setError('This file could not be played directly.')
      }
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('error', onError)

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onError)
      hls?.destroy()
    }
  }, [url, mode])

  // Persist the playback position.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let lastSaved = 0
    const save = () => {
      const current = video.currentTime
      if (!current || video.readyState === 0 || Math.abs(current - lastSaved) < 1) return
      lastSaved = current
      api
        .torrentStatus(sessionId)
        .then((status) => {
          if (!status?.infoHash) return
          void api
            .librarySaveProgress({
              infoHash: status.infoHash,
              fileIndex,
              positionSec: current,
              durationSec: video.duration || undefined,
              updatedAt: Date.now(),
              title: title ?? status.name,
              theme,
              imdbId
            })
            .catch((err) => console.warn('[player] progress save failed', err))
        })
        .catch((err) => console.warn('[player] status fetch failed', err))
    }

    const interval = setInterval(save, 5000)
    video.addEventListener('timeupdate', save)
    return () => {
      clearInterval(interval)
      video.removeEventListener('timeupdate', save)
      save()
    }
  }, [sessionId, fileIndex, url, theme, imdbId, title])

  // Space toggles play/pause, Escape closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      // Leave Space alone when a control is focused — it would both activate
      // the control and toggle playback.
      const target = event.target as HTMLElement | null
      const interactive = target?.closest(
        'button, input, select, textarea, a, [role="button"]'
      )
      if (event.code === 'Space' && videoRef.current && !interactive) {
        event.preventDefault()
        if (videoRef.current.paused) void videoRef.current.play()
        else videoRef.current.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Stop the HLS transcoder when the player closes, and stop the video.
  useEffect(() => {
    return () => {
      void api.streamStop(sessionId)
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onDoubleClick={() => void containerRef.current?.requestFullscreen()}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 bg-ink-900 px-4">
        <span className="text-sm font-medium text-mist-100">Player</span>
        {status && <span className="text-xs text-mist-400">{status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {onStop && (
            <button
              onClick={() => {
                void api.streamStop(sessionId)
                onStop()
              }}
              title="Stop download and close player"
              aria-label="Stop download"
              className="flex items-center gap-1.5 rounded-lg border border-bad-500/40 bg-bad-500/10 px-2 py-1.5 text-xs text-bad-500 transition-colors hover:bg-bad-500/20"
            >
              <Octagon size={13} fill="currentColor" />
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            title="Close player (download keeps running)"
            aria-label="Close player"
            className="rounded-lg border border-ink-600 bg-ink-800 p-1.5 text-mist-400 transition-colors hover:text-mist-100"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          crossOrigin="anonymous"
          className="max-h-full max-w-full bg-black"
        >
          {subtitles.map((track) => (
            <track
              key={track.url}
              kind="subtitles"
              src={track.url}
              label={track.label}
              srcLang={track.lang}
              {...({ crossOrigin: 'anonymous' } as Record<string, string>)}
            />
          ))}
        </video>

        {!error && status !== 'Playing' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-ink-900/80 px-4 py-2 text-xs text-mist-200">
              <Loader2 size={14} className="spin" />
              {status}
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8">
            <div className="max-w-md rounded-lg border border-bad-500/40 bg-ink-900 p-4 text-center">
              <AlertTriangle size={20} className="mx-auto mb-2 text-bad-500" />
              <p className="text-sm text-mist-100">{error}</p>
              {canForceTranscode && (
                <button
                  onClick={() => {
                    setError(null)
                    setUrl(null)
                    void api
                      .streamStart({ sessionId, fileIndex, forceTranscode: true })
                      .then((target) => {
                        setMode(target.mode)
                        setUrl(target.url)
                        setCanForceTranscode(false)
                      })
                  }}
                  className="mt-3 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500"
                >
                  Retry with transcoding
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
