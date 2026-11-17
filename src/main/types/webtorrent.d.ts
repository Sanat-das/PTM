declare module 'webtorrent' {
  interface WebTorrentFile {
    name: string
    path: string
    length: number
    type: string
    createReadStream(opts?: { start?: number; end?: number }): AsyncIterable<Uint8Array>
    [Symbol.asyncIterator](opts?: { start?: number; end?: number }): AsyncIterable<Uint8Array>
  }

  interface WebTorrentTorrent {
    infoHash?: string
    name?: string
    files: WebTorrentFile[]
    progress: number
    downloadSpeed: number
    uploadSpeed: number
    numPeers: number
    ready: boolean
    destroy(cb?: () => void): void
    on(event: string, cb: (...args: unknown[]) => void): void
  }

  interface WebTorrentOptions {
    dht?: boolean
    lsd?: boolean
    tracker?: boolean
    utp?: boolean
    webSeeds?: boolean
    path?: string
    torrentPort?: number
  }

  export default class WebTorrent {
    constructor(options?: WebTorrentOptions)
    add(input: string, opts?: Record<string, unknown>): WebTorrentTorrent
    destroy(cb?: () => void): void
    on(event: string, cb: (...args: unknown[]) => void): void
  }
}
