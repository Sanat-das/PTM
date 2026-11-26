# Changelog

All notable changes to Play Torrent Media (PTM) are documented here. Dates are ISO (YYYY-MM-DD).

## [0.3.0] - 2026-11-23

### Added
- **Browse** view: query-free browsing by category (Movies, WEB Movies, BluRay, TV, HD TV,
  Anime, Music, Games, Books, Apps), with the existing quality filters applied on top.
- **Discover** view: TMDB recommendations by kind, genre, year, minimum rating and sort, a
  "Surprise me" shuffle, and one-click torrent search from each card. Titles load 20 at a
  time with a **Show more** button.

### Fixed
- Browse requests to apibay now use the `*` wildcard — an empty query returned no rows.
- Replaced the empty HD Movies category (`cat=210`) with WEB Movies (`cat=209`).
- Submitting a search from Browse or Discover now switches to the Search view and clears the
  category theme Browse injects, so the query runs and its results are shown instead of being
  ignored or filtered away.

### Changed
- Movie-genre chips no longer appear under Browse; genre browsing lives in the Discover tab.
- Playback of non-browser containers now stream-copies H.264/AAC into fMP4 HLS
  instead of re-encoding with libx264. Only unsupported codecs take the
  transcode fallback, so large files start much sooner.
- Open-ended HTTP byte ranges are capped to 8 MB, so the browser no longer
  holds a whole multi-GB file stream open to fill its buffer.
- hls.js preloads less before the first frame.

### Removed
- The qBittorrent engine, its settings/UI switch and the "wait for the whole
  torrent before playback" path. The built-in WebTorrent engine is now the
  only download engine.

## [0.2.2] - 2026-11-18

### Added
- Auto-updater wired in (inert until a `publish` feed is set in `electron-builder.yml`).
- Startup resume now retries error items in addition to interrupted and paused ones.
- Settings footer shows the app version.
- Library panel shows a "Stalled" badge for downloads with no peers and no traffic.
- CHANGELOG.md (this file).

### Changed
- `scan()` and folder walking are fully async — no more UI freezes on large download folders.
- Release-folder "Sample" subdirectories are no longer auto-imported as separate movies.
- Store subscriptions use individual selectors — no more re-render storms per keystroke.
- Tests now cover `net/http` and all five index providers (108 tests total).

## [0.2.1] - 2026-11-18

### Added
- Incomplete downloads auto-resume on launch; paused ones re-pause after re-adding.

### Fixed
- "Delete files" on a library item now removes the release folder and its contents
  (never the download root, never a folder containing another tracked item's files).
- Files go to the system Recycle Bin instead of being permanently unlinked.
- Paused downloads in the library are labelled "Paused" (was "Stopped").
- Player header and window title show the actual media title.
- Settings footer and Library buttons got busy states; several a11y gaps closed
  (focus trap in dialogs, global focus-visible ring, accessible field names).

## [0.2.0] - 2026-11-18

### Added
- **Downloads library**: finished torrents and disk imports are tracked in a
  local store, can be played directly from disk, scanned via the Import button,
  paused/resumed, and deleted from the library.
- "Pause video playback while minimized" (Settings → Behaviour).
- Stream starts from qBittorrent/incomplete files with resume-from-position;
  audio track switching; external subtitles surfaced in the player.
- Diagnostics panel; proxy support for indexes and the torrent engine;
  per-provider health dots.

### Fixed (security and correctness audit)
- Torrent-controlled file paths are clamped to the download root everywhere.
- IPC inputs are validated at the boundary.
- qBittorrent engine: refresh no longer freezes on a failing sub-request,
  hash discovery for URL-added torrents, sane API timeouts.
- Built-in engine recovers after init failure; watchdog cleared on metadata.
- HLS hardening: app-origin CORS, loopback Host check, segment whitelist,
  generic 502 body, old transcode survives a failed replacement spawn.
- UI/UX pass across all panels (focus, feedback, terminology, contrast).

## [0.1.0] - Initial release

Search across public indexes, filter by theme and quality, YouTube trailers,
and in-app playback of streamed torrents (built-in engine or qBittorrent).
