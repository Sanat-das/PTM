# PTM — Play Torrent Media

Search public torrent indexes, filter by theme and quality, watch YouTube trailers, and play in
the same app.

Built with Electron + React + TypeScript. Everything torrent-side runs in the main process;
the renderer only talks to a local HTTP server, so the browser does the buffering, seeking and
hardware decoding.

## Quick start

```bash
npm install
node node_modules/ffmpeg-static/install.js   # downloads the ffmpeg binary
npm run dev
```

`npm run dev` starts the Vite dev server and the Electron app together, with hot reload.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server + app with hot reload |
| `npm run build` | Production build into `out/` |
| `npm run typecheck` | Typecheck main/preload and renderer |
| `npm test` | Unit tests (filters, release parser, stream server) |
| `npm run dist` | Verify the ffmpeg binary exists, build and package a Windows installer into `release/` |

Note: npm may block post-install scripts. If Electron or ffmpeg is missing after `npm install`,
run `node node_modules/electron/install.js` and `node node_modules/ffmpeg-static/install.js`.

## How it works

```
search  ──▶ provider adapters ──▶ normalise ──▶ client-side filters
                                            │
trailers ─▶ YouTube (InnerTube, no key) ◀─────┤
                                            │
play    ─▶ engine ──▶ local HTTP range server ──▶ <video> / hls.js
              └─▶ ffmpeg ──▶ HLS when the container needs it
```

### Indexes

Each provider is a small adapter behind one interface. The registry fans a query out to every
enabled provider in parallel, normalises the rows, dedupes by info hash (and by release identity —
title, year, episode, resolution, source, codec — for indexes that don't expose hashes), then
returns everything. Filters run in the renderer, so changing a chip never triggers a new network call.

Shipped adapters: The Pirate Bay (apibay JSON), Nyaa (RSS), YTS (movie API), EZTV (by IMDb id,
second pass), 1337x (HTML, up to 2 listing pages).

### Browse and Discover

The view switcher under the search bar offers three ways to find something:

- **Search** — the original query-driven search across all enabled indexes.
- **Browse** — query-free browsing by category (Movies, WEB Movies, BluRay, TV, HD TV, Anime,
  Music, Games, Books, Apps). It sends an empty query plus the provider's native category id, so
  apibay/YTS/Nyaa return their newest rows; the usual quality filters still apply on top. For
  genre-based browsing, use the Discover tab.
- **Discover** — TMDB recommendations chosen by kind (movie/TV), genre, year, minimum rating and
  sort, with a "Surprise me" shuffle. Each card has a **Find torrents** button that searches its
  title and year. Titles load 20 at a time from TMDB; **Show more** fetches the next page. This view
  needs the optional TMDB API key (Settings → Metadata); Search and Browse work without it.

### Release parsing

The parser turns `Breaking.Bad.S08.COMPLETE.1080p.WEB-DL.DDP5.1.H.264-NTb` into a title, year,
resolution, source, codec, season/episode, group and theme. That is what powers the theme and
quality filters, and it is also what the YouTube query uses, so a clean title matters.

### Playback

- The engine exposes a file as byte ranges. A local server on `127.0.0.1` (random port, random
  path token) serves them with proper `Range` support.
- **Pause video playback while the app is minimized** (Settings → Behaviour) pauses the
  `<video>` when the window is minimized and resumes it on restore. Playback you paused
  yourself stays paused.
- MP4/WebM play directly in the video element.
- MKV/AVI and other containers are fed to ffmpeg, which writes an HLS playlist for `hls.js`.
  H.264/AAC streams are copied into fMP4 segments without re-encoding, so playback starts almost
  immediately; other codecs fall back to a libx264/AAC transcode. This is why ffmpeg ships with the
  app.
- Finished files are written to the **Downloads** folder by default. Change it in Settings →
  Downloads (path or folder picker), the built-in engine resolves the folder per torrent, so a
  change applies to the next download without a restart.
- The built-in WebTorrent engine streams a file while it downloads, so playback can start before
  the torrent is complete.

"
### Torrents in progress

- The top bar shows a downloads pill (e.g. `↓ 1.2 MB/s · 1`) with the combined speed; it turns
  amber whenever at least one torrent is paused.
- The session card in the detail panel shows peers, speed, progress and state (`fetching-metadata`, `downloading`, `paused`, `complete`, `error`).
- Pause/resume and Stop are per torrent; Stop destroys the torrent but keeps downloaded files on disk.
- Torrents are de-duplicated by info hash: re-adding the same magnet reuses the existing session (and resumes it if paused) instead of erroring.
### Proxy

HTTP and SOCKS5 proxies are supported for index lookups (via proxy agents) and for the torrent
engine's TCP traffic (by tunnelling `net.connect`; this is process-wide, so outbound TCP from the
main process — including tracker HTTP announces — follows the tunnel). UDP cannot be tunnelled,
so DHT and UDP trackers will not work through it. Note: HTTP/SOCKS proxy agents already dial the proxy directly; the `net.connect`
tunnel exists for the torrent engine. A non-loopback proxy host is excluded from the tunnel to
avoid double-proxying the agent connections; index lookups and the engine both go through the
proxy either way.

## Network caveats

Public index sites and trackers are blocked or intercepted on a lot of networks. The app is built
for that:

- Every provider is checked individually and shown in the header as a green/red dot.
- Diagnostics (the pulse icon) tests each index and the configured HTTPS/WSS trackers
  (plain TCP — UDP trackers are skipped as unprobeable), plus YouTube and the metadata
  source, so you can see exactly what your network permits.
- Networks that block UDP (DHT, UDP trackers) and plain HTTP — common on corporate
  networks — leave only the WSS trackers working. If peers never connect, enable the
  proxy (Settings → Network proxy): the torrent engine’s TCP traffic (peers, HTTPS/WSS
  trackers) tunnels through HTTP CONNECT, which is usually the only path out.
- If a swarm cannot be reached within 45 seconds, the player says so instead of spinning.

## Settings worth knowing

- **Proxy** — HTTP or SOCKS5, with optional auth.
- **Trackers** — the announce list appended to magnet links. HTTPS and WSS trackers are the ones
  that survive a restrictive network.
- **TMDB API key** — optional. Adds posters, ratings, runtimes and genres. Everything else works
  without it.
- **Indexes** — disable any provider you do not want.

## Security notes

The renderer runs with `contextIsolation`, no node integration, and a Content-Security-Policy
that allows only same-origin resources, the local stream server (`http://127.0.0.1:*`), HTTPS
images and inline styles (Tailwind); `object-src`, `base-uri`, `form-action` and framing are all
denied. (`sandbox` is off only because the ESM preload requires it; the preload touches nothing
but `ipcRenderer` and `contextBridge`.) The stream server binds to loopback and requires a
per-launch token. TMDB API keys are redacted from logged URLs. No content is bundled: the app
only talks to public index APIs and standard BitTorrent and YouTube protocols. See `LICENSE`
(MIT).

## Project layout

```
src/
  shared/     types, release parser, filters, IPC contract
  main/       app lifecycle, providers, engine, stream server, YouTube, metadata
  preload/    context bridge
  renderer/   React UI
```
