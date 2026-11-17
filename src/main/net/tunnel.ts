import net from 'node:net'
import { SocksClient } from 'socks'
import type { ProxyConfig } from '../../shared/types.ts'

/**
 * Establishes a TCP tunnel to `target` through an HTTP CONNECT or SOCKS5 proxy.
 * Used to route the torrent engine's peer connections through a local proxy.
 */
export async function createTunnel(
  targetHost: string,
  targetPort: number,
  proxy: ProxyConfig
): Promise<net.Socket> {
  if (proxy.type === 'socks5') {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.username,
        password: proxy.password
      },
      command: 'connect',
      destination: { host: targetHost, port: targetPort },
      timeout: 15000
    })
    return socket
  }

  return httpConnect(targetHost, targetPort, proxy)
}

function httpConnect(
  targetHost: string,
  targetPort: number,
  proxy: ProxyConfig
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    let buffer = ''
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(15000, () => fail(new Error('Proxy CONNECT timed out')))

    socket.on('error', fail)

    function onData(chunk: Buffer) {
      buffer += chunk.toString('latin1')
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      const statusLine = buffer.slice(0, buffer.indexOf('\r\n'))
      const status = Number(statusLine.split(' ')[1])
      if (status !== 200) {
        fail(new Error(`Proxy CONNECT failed with status ${status}`))
        return
      }
      settled = true
      socket.setTimeout(0)
      socket.removeListener('data', onData)
      // Anything after the headers is already buffered payload.
      const rest = Buffer.from(buffer.slice(end + 4), 'latin1')
      if (rest.length) socket.unshift(rest)
      resolve(socket)
    }

    socket.on('data', onData)

    const auth = proxy.username
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}\r\n`
      : ''

    socket.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        auth +
        'Proxy-Connection: Keep-Alive\r\n\r\n'
    )
  })
}

let installed = false
let originalConnect: typeof net.connect | null = null

/**
 * Patch `net.connect` so every outbound TCP connection in the main process is
 * routed through the configured proxy. Only outbound connections to non-loopback
 * hosts are affected; the local streaming server keeps working normally.
 *
 * Note: UDP (DHT, UDP trackers) is not tunnelled — only TCP peers and HTTP trackers.
 */
export function installProxyTunnel(proxy: ProxyConfig | null): void {
  if (!proxy?.enabled) {
    removeProxyTunnel()
    return
  }
  if (installed) {
    ;(net as unknown as { connect: typeof net.connect }).connect = originalConnect!
    installed = false
  }

  originalConnect = net.connect
  const patched = function (
    this: unknown,
    ...args: unknown[]
  ): net.Socket {
    const options = args[0] as
      | { host?: string; port?: number; path?: string }
      | number
    const host =
      typeof options === 'object' && options !== null
        ? options.host
        : typeof args[1] === 'string'
          ? args[1]
          : undefined
    const port =
      typeof options === 'object' && options !== null
        ? options.port
        : typeof options === 'number'
          ? options
          : undefined

    const isLocal =
      !host ||
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0'

    // The proxy connection itself must never be tunnelled, or it would loop.
    const isProxyItself =
      Boolean(proxy.host) && host?.toLowerCase() === proxy.host.toLowerCase() && port === proxy.port

    if (isLocal || !port || isProxyItself) {
      return (originalConnect as (...a: unknown[]) => net.Socket).apply(net, args)
    }

    return createDeferredTunnelSocket(host, port, proxy)
  } as unknown as typeof net.connect

  ;(net as unknown as { connect: typeof net.connect }).connect = patched
  ;(net as unknown as { createConnection: typeof net.createConnection }).createConnection =
    patched
  installed = true
}

export function removeProxyTunnel(): void {
  if (!installed || !originalConnect) return
  ;(net as unknown as { connect: typeof net.connect }).connect = originalConnect
  ;(net as unknown as { createConnection: typeof net.createConnection }).createConnection =
    originalConnect
  installed = false
  originalConnect = null
}

/**
 * Returns a socket immediately (like net.connect) but connects through the
 * proxy in the background. Writes issued before the tunnel is up are buffered.
 */
function createDeferredTunnelSocket(
  host: string,
  port: number,
  proxy: ProxyConfig
): net.Socket {
  const outer: net.Socket = new net.Socket()
  ;(outer as unknown as { connecting: boolean }).connecting = true

  const pending: Buffer[] = []
  let inner: net.Socket | null = null
  let destroyed = false

  Object.defineProperty(outer, 'readyState', {
    configurable: true,
    get() {
      if (destroyed) return 'closed'
      return inner ? 'open' : 'opening'
    }
  })

  outer.write = ((chunk: Buffer | string, encoding?: unknown, callback?: unknown) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    if (inner) {
      inner.write(buffer)
    } else {
      pending.push(buffer)
    }
    if (typeof callback === 'function') (callback as () => void)()
    return true
  }) as net.Socket['write']

  outer.destroy = ((error?: Error) => {
    destroyed = true
    ;(outer as unknown as { connecting: boolean }).connecting = false
    inner?.destroy()
    if (!error) outer.emit('close', false)
    else outer.emit('error', error)
    return outer
  }) as net.Socket['destroy']

  outer.end = (() => {
    inner?.end()
    return outer
  }) as net.Socket['end']

  createTunnel(host, port, proxy)
    .then((socket) => {
      if (destroyed) {
        socket.destroy()
        return
      }
      inner = socket
      ;(outer as unknown as { connecting: boolean }).connecting = false
      for (const chunk of pending) socket.write(chunk)
      pending.length = 0

      socket.on('data', (chunk: Buffer) => outer.emit('data', chunk))
      socket.on('end', () => outer.emit('end'))
      socket.on('close', () => {
        destroyed = true
        outer.emit('close', false)
      })
      socket.on('error', (error: Error) => outer.emit('error', error))

      outer.emit('connect', socket.remoteAddress ?? host, socket.remotePort ?? port)
      outer.emit('ready')
    })
    .catch((error: Error) => {
      destroyed = true
      ;(outer as unknown as { connecting: boolean }).connecting = false
      outer.emit('error', error)
    })

  return outer
}
