import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, AlertTriangle, Octagon, Volume2, Check } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { AudioTrackInfo } from '../../../shared/types.ts'
import { APP_NAME } from '../../../shared/version.ts'

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

/** Compare two audio language tags ignoring 2/3-letter differences. */
function languageKey(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  const lower = tag.trim().toLowerCase()
  return LANGUAGE_LABELS[lower] ?? lower
}

function audioLanguageLabel(track: AudioTrackInfo): string {
  if (track.language) {
    const known = LANGUAGE_LABELS[track.language.toLowerCase()]
    if (known) return known
  }
  return track.title ?? `Track ${track.index + 1}`
}

function audioDetail(track: AudioTrackInfo): string {
  const parts = [track.codec?.toUpperCase()]
  if (track.channels === 1) parts.push('Mono')
  else if (track.channels === 2) parts.push('Stereo')
  else if (track.channels === 6) parts.push('5.1')
  else if (track.channels === 8) parts.push('7.1')
  else if (track.channels) parts.push(`${track.channels}ch`)
  if (track.isDefault) parts.push('Default')
  return parts.filter(Boolean).join(' · ')
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
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Whether the visibility hook paused the video (so restore can resume it),
  // as opposed to the user pressing pause themselves.
  const autoPausedRef = useRef(false)
  // Position to restore after an audio-track switch reloads the stream.
  const pendingSeekRef = useRef<number | null>(null)
  // The remembered-language preference is applied once per file, not on every render.
  const preferenceAppliedRef = useRef(false)
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settingsGet(),
    staleTime: Infinity
  })
  // Disk playback (completed download / import) has no live engine session to
  // stop — the Stop button is hidden in that case.
  const downloadItemQuery = useQuery({
    queryKey: ['download-item', sessionId],
    queryFn: () => api.downloadsGet(sessionId),
    staleTime: Infinity
  })
  const isLocalPlayback = Boolean(downloadItemQuery.data)
  const pausePlaybackOnMinimize = settingsQuery.data?.pausePlaybackOnMinimize ?? false
  const [url, setUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<'direct' | 'hls'>('direct')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Preparing stream…')
  const [canForceTranscode, setCanForceTranscode] = useState(false)
  const [subtitles, setSubtitles] = useState<
    Array<{ url: string; label: string; lang?: string }>
  >([])
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[] | null>(null)
  const [selectedAudio, setSelectedAudio] = useState<number | null>(null)
  const [audioMenuOpen, setAudioMenuOpen] = useState(false)
  const [stopArmed, setStopArmed] = useState(false)

  // Keep the window title meaningful instead of just the app name.
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME
    return () => {
      document.title = previous
    }
  }, [title])

  // Disarm the two-step Stop after a few seconds.
  useEffect(() => {
    if (!stopArmed) return
    const timer = setTimeout(() => setStopArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [stopArmed])

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

  // List the embedded audio streams; files with a single track need no menu.
  useEffect(() => {
    let cancelled = false
    setAudioTracks(null)
    setSelectedAudio(null)
    setAudioMenuOpen(false)
    preferenceAppliedRef.current = false

    api
      .audioTracks(sessionId, fileIndex)
      .then((tracks) => {
        if (!cancelled) setAudioTracks(tracks)
      })
      .catch(() => {
        if (!cancelled) setAudioTracks([])
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, fileIndex])

  // Preselect the remembered language when it is available and differs from
  // the file's default track (switching means a transcode, so it is only
  // applied when playback would not already pick it).
  const preferredLanguage = settingsQuery.data?.preferredAudioLanguage
  useEffect(() => {
    if (preferenceAppliedRef.current) return
    if (!audioTracks || preferredLanguage === undefined) return
    preferenceAppliedRef.current = true

    const match = audioTracks.find(
      (track) => languageKey(track.language) === languageKey(preferredLanguage)
    )
    if (!match) return
    const defaultIndex = audioTracks.find((track) => track.isDefault)?.index ?? 0
    if (match.index !== defaultIndex) setSelectedAudio(match.index)
  }, [audioTracks, preferredLanguage])

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
        setUrl(null)
        const switching = selectedAudio !== null
        setStatus(switching ? 'Switching audio…' : forceTranscode ? 'Starting transcoder…' : 'Preparing stream…')
        const target = await api.streamStart({
          sessionId,
          fileIndex,
          forceTranscode,
          audioTrack: switching ? selectedAudio : undefined
        })
        if (cancelled) return

        setMode(target.mode)
        setUrl(target.url)
        setCanForceTranscode(target.mode === 'direct' && selectedAudio === null)
        setStatus(
          target.mode === 'hls' ? 'Buffering from torrent…' : 'Connecting to torrent…'
        )
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }

    void start(false)
    return () => {
      cancelled = true
    }
  }, [sessionId, fileIndex, selectedAudio])

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
            backBufferLength: 60,
            // The source is local (disk or a fast byte-range server), so a
            // small look-ahead starts playback sooner; a large preload only
            // delays the first frame.
            maxBufferLength: 12,
            maxBufferSize: 24 * 1000 * 1000,
            maxMaxBufferLength: 30,
            manifestLoadingMaxRetry: 6,
            levelLoadingMaxRetry: 6,
            fragLoadingMaxRetry: 8
          })
          hls.loadSource(url)
          hls.attachMedia(video)

          let retries = 0
          let mediaRetries = 0
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            retries = 0
            mediaRetries = 0
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
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 3) {
              // Unbounded recoverMediaError loops churn the buffer forever;
              // give up after a few attempts and surface the error.
              mediaRetries += 1
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
      // A pending seek wins: after an audio-track switch, resume where the
      // user was rather than from the original resume point.
      const seek = pendingSeekRef.current ?? resumePositionSec
      pendingSeekRef.current = null
      if (seek && seek > 0) {
        video.currentTime = seek
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
      // Release the old source so a re-run doesn't keep the old connection
      // or stale range requests alive.
      video.removeAttribute('src')
      video.load()
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
      if (Number.isNaN(current) || video.readyState === 0 || Math.abs(current - lastSaved) < 1) return
      lastSaved = current
      api
        .torrentStatus(sessionId)
        .then((status) => {
          if (status?.infoHash) {
            return { hash: status.infoHash, fallbackTitle: status.name }
          }
          // No engine session: the file is streamed from disk (completed
          // download or import), so the downloads library holds the identity.
          return api.downloadsGet(sessionId).then((item) =>
            item ? { hash: item.infoHash ?? item.id, fallbackTitle: item.title } : null
          )
        })
        .then((resolved) => {
          if (!resolved) return
          void api
            .librarySaveProgress({
              infoHash: resolved.hash,
              fileIndex,
              positionSec: current,
              durationSec: video.duration || undefined,
              updatedAt: Date.now(),
              title: title ?? resolved.fallbackTitle,
              theme,
              imdbId
            })
            .catch((err) => console.warn('[player] progress save failed', err))
        })
        .catch((err) => console.warn('[player] progress save failed', err))
    }

    const interval = setInterval(save, 5000)
    video.addEventListener('timeupdate', save)
    return () => {
      clearInterval(interval)
      video.removeEventListener('timeupdate', save)
      save()
    }
  }, [sessionId, fileIndex, url, theme, imdbId, title])

  // Chromium cannot pick a different embedded track in-band, so switching
  // re-transcodes with the chosen track mapped in and resumes where the
  // playhead was. Also remembers the language for future files.
  const selectAudioTrack = (track: AudioTrackInfo) => {
    setAudioMenuOpen(false)
    // `selectedAudio` stays null until the user switches once, so compare
    // against the track that is actually playing (the default, or the
    // user's earlier pick) — not raw state — to avoid a pointless restart.
    const effective = selectedAudio ?? audioTracks?.find((t) => t.isDefault)?.index ?? 0
    if (track.index === effective) return
    const current = videoRef.current?.currentTime ?? 0
    if (current > 0) pendingSeekRef.current = current
    setSelectedAudio(track.index)
    if (track.language) {
      api
        .settingsSet({ preferredAudioLanguage: track.language })
        .then((saved) => queryClient.setQueryData(['settings'], saved))
        .catch((err) =>
          console.warn('[player] failed to save preferred audio language', err)
        )
    }
  }

  // Space toggles play/pause, Escape closes (the audio menu first, then the
  // player), F toggles fullscreen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (audioMenuOpen) {
          event.preventDefault()
          setAudioMenuOpen(false)
          return
        }
        onClose()
        return
      }
      const target = event.target as HTMLElement | null
      const interactive = target?.closest(
        'button, input, select, textarea, a, [role="button"]'
      )
      if (event.key === 'f' && !interactive) {
        event.preventDefault()
        if (document.fullscreenElement) void document.exitFullscreen()
        else void containerRef.current?.requestFullscreen()
        return
      }
      // Leave Space alone when a control is focused — it would both activate
      // the control and toggle playback.
      if (event.code === 'Space' && videoRef.current && !interactive) {
        event.preventDefault()
        if (videoRef.current.paused) void videoRef.current.play()
        else videoRef.current.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, audioMenuOpen])

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
      onDoubleClick={() => {
        const container = containerRef.current
        if (document.fullscreenElement) void document.exitFullscreen()
        else void container?.requestFullscreen()
      }}
      title="Double-click or F for fullscreen"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 bg-ink-900 px-4">
        <span className="max-w-[50%] truncate text-sm font-medium text-mist-100" title={title ?? 'Player'}>
          {title ?? 'Player'}
        </span>
        {status && <span className="text-xs text-mist-400">{status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {audioTracks && audioTracks.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setAudioMenuOpen((open) => !open)}
                title="Audio language"
                aria-label="Audio language"
                aria-expanded={audioMenuOpen}
                className="flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 p-1.5 text-mist-400 transition-colors hover:text-mist-100"
              >
                <Volume2 size={16} />
              </button>
              {audioMenuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-0 cursor-default"
                    aria-label="Close audio menu"
                    onClick={() => setAudioMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    aria-label="Audio language"
                    className="absolute right-0 top-full z-10 mt-2 w-64 overflow-hidden rounded-lg border border-ink-600 bg-ink-800 shadow-xl"
                  >
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-mist-400">
                      Audio language
                    </div>
                    {audioTracks.map((track) => {
                      const active =
                        track.index ===
                        (selectedAudio ?? audioTracks.find((t) => t.isDefault)?.index ?? 0)
                      return (
                        <button
                          key={track.index}
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => selectAudioTrack(track)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-ink-700"
                        >
                          <span className="flex w-4 shrink-0 justify-center text-accent-500">
                            {active && <Check size={13} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs text-mist-100">
                              {audioLanguageLabel(track)}
                            </span>
                            {audioDetail(track) && (
                              <span className="block text-[10px] text-mist-400">
                                {audioDetail(track)}
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                    <div className="border-t border-ink-700 px-3 py-1.5 text-[10px] text-mist-400">
                      Switching re-starts the stream in the chosen language.
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {onStop && !isLocalPlayback && (
            <button
              onClick={() => {
                if (!stopArmed) {
                  setStopArmed(true)
                  return
                }
                setStopArmed(false)
                void api.streamStop(sessionId)
                onStop()
              }}
              title={stopArmed ? 'Click again to stop this download' : 'Stop download and close player'}
              aria-label={stopArmed ? 'Confirm stop download' : 'Stop download'}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                stopArmed
                  ? 'border-bad-500 bg-bad-500/25 font-medium text-bad-500'
                  : 'border-bad-500/40 bg-bad-500/10 text-bad-500 hover:bg-bad-500/20'
              }`}
            >
              <Octagon size={13} fill="currentColor" />
              {stopArmed ? 'Stop?' : 'Stop'}
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
                      .streamStart({
                        sessionId,
                        fileIndex,
                        forceTranscode: true,
                        audioTrack: selectedAudio ?? undefined
                      })
                      .then((target) => {
                        setMode(target.mode)
                        setUrl(target.url)
                        setCanForceTranscode(false)
                      })
                      .catch((err) => setError((err as Error).message))
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
