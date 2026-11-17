# PTM

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
| `npm run dist` | Build and package a Windows installer into `release/` |

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

### Release parsing

The parser turns `Breaking.Bad.S08.COMPLETE.1080p.WEB-DL.DDP5.1.H.264-NTb` into a title, year,
resolution, source, codec, season/episode, group and theme. That is what powers the theme and
quality filters, and it is also what the YouTube query uses, so a clean title matters.

### Playback

- The engine exposes a file as byte ranges. A local server on `127.0.0.1` (random port, random
  path token) serves them with proper `Range` support.
- MP4/WebM play directly in the video element.
- MKV/AVI and other containers are piped through ffmpeg into an HLS playlist that `hls.js` plays.
  This is why ffmpeg ships with the app.
- Finished files are written to the **Downloads** folder by default. Change it in Settings →
  Downloads (path or folder picker); the same value is passed to qBittorrent as its save path. The
  built-in engine resolves the folder per torrent, so a change applies to the next download without
  a restart.
- Two engine implementations sit behind one interface: the built-in WebTorrent engine, and an
  adapter that drives an installed qBittorrent through its Web API. Switch in the top bar.

"
### Torrents in progress

- The top bar shows a downloads pill (e.g. `↓ 1.2 MB/s · 1`) with the combined speed; it turns amber when torrents are paused.
- The session card in the detail panel shows peers, speed, progress and state (`fetching-metadata`, `downloading`, `paused`, `complete`, `error`).
- Pause/resume and Stop are per torrent; Stop destroys the torrent but keeps downloaded files on disk.
- **Pause downloads while the app is minimized** (Settings → Behaviour) halts every torrent on minimize and resumes them on restore.
- Torrents are de-duplicated by info hash: re-adding the same magnet reuses the existing session (and resumes it if paused) instead of erroring.
### Proxy

HTTP and SOCKS5 proxies are supported for index lookups (via proxy agents) and for the torrent
engine's TCP traffic (by tunnelling `net.connect`). UDP cannot be tunnelled, so DHT and UDP
trackers will not work through it — use the qBittorrent engine if your setup depends on them.

## Network caveats

Public index sites and trackers are blocked or intercepted on a lot of networks. The app is built
for that:

- Every provider is checked individually and shown in the header as a green/red dot.
- Diagnostics (the pulse icon) tests each index, the configured trackers, YouTube and the metadata
  source separately, so you can see exactly what your network permits.
- If a swarm cannot be reached within 45 seconds, the player says so instead of spinning.

## Settings worth knowing

- **Proxy** — HTTP or SOCKS5, with optional auth.
- **Trackers** — the announce list appended to magnet links. HTTPS and WSS trackers are the ones
  that survive a restrictive network.
- **TMDB API key** — optional. Adds posters, ratings, runtimes and genres. Everything else works
  without it.
- **Indexes** — disable any provider you do not want.

## Security notes

The renderer runs with `contextIsolation`, no node integration, and a Content-Security-Policy that
allows only YouTube frames and the local stream server. The stream server binds to loopback and
requires a per-launch token. No content is bundled: the app only talks to public index APIs and
standard BitTorrent and YouTube protocols.

## Project layout

```
src/
  shared/     types, release parser, filters, IPC contract
  main/       app lifecycle, providers, engine, stream server, YouTube, metadata
  preload/    context bridge
  renderer/   React UI
```
