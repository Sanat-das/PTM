import http from 'node:http'
import https from 'node:https'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { ProxyConfig } from '../../shared/types.ts'

export interface HttpTextResult {
  status: number
  body: string
  headers: Record<string, string>
}

export interface HttpBufferResult {
  status: number
  body: Buffer
  headers: Record<string, string>
}

export interface HttpRequestOptions {
  headers?: Record<string, string>
  /**
   * Absolute wall-clock deadline for the whole operation (all redirects
   * included), in milliseconds. Defaults to 15000.
   */
  timeout?: number
  proxy?: ProxyConfig
  maxRedirects?: number
  method?: string
  body?: string
  /**
   * Response bodies larger than this are aborted. Defaults to 25 MiB, which
   * is far above any sane API/HTML payload and below what we want buffered
   * in memory for a hostile or broken endpoint.
   */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

/** Strip credentials embedded in query strings (TMDB api_key et al.) for logs. */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    for (const key of ['api_key', 'key', 'token', 'password', 'username']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]')
    }
    return url.toString()
  } catch {
    return rawUrl.replace(/([?&](?:api_key|key|token|password)=)[^&]+/gi, '$1[redacted]')
  }
}

function agentFor(url: URL, proxy: ProxyConfig | undefined): http.Agent | undefined {
  if (!proxy?.enabled) return undefined
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : ''
  const proxyUrl = `${proxy.type}://${auth}${proxy.host}:${proxy.port}`

  if (proxy.type === 'socks5') return new SocksProxyAgent(proxyUrl)
  return url.protocol === 'https:' ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl)
}

/**
 * Minimal HTTP(S) client that honours the app's proxy configuration.
 * Uses Node core http/https with proxy agents rather than global fetch so that
 * SOCKS5 works the same way as HTTP proxies.
 *
 * Enforced limits: an absolute deadline for the entire operation (not just
 * socket idle time), a response-size cap, and a redirect cap.
 */
export async function httpText(
  rawUrl: string,
  options: HttpRequestOptions = {}
): Promise<HttpTextResult> {
  const result = await httpBuffer(rawUrl, options)
  return { ...result, body: result.body.toString('utf8') }
}

/** Same as httpText, but keeps the raw bytes (torrent files, binary data). */
export async function httpBuffer(
  rawUrl: string,
  options: HttpRequestOptions = {}
): Promise<HttpBufferResult> {
  const maxRedirects = options.maxRedirects ?? 5
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const deadlineMs = options.timeout ?? 15000
  const started = Date.now()

  let currentUrl = rawUrl
  let method = options.method ?? 'GET'
  let body = options.body

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const remaining = deadlineMs - (Date.now() - started)
    if (remaining <= 0) {
      throw new Error(`Request to ${sanitizeUrl(currentUrl)} timed out after ${deadlineMs}ms`)
    }
    const url = new URL(currentUrl)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http

    const result = await new Promise<HttpBufferResult>((resolvePromise, rejectPromise) => {
      // The absolute deadline must be released on every settle path.
      let timer: NodeJS.Timeout | null = null
      const resolve = (value: HttpBufferResult) => {
        if (timer) clearTimeout(timer)
        resolvePromise(value)
      }
      const reject = (reason?: unknown) => {
        if (timer) clearTimeout(timer)
        rejectPromise(reason)
      }

      const req = transport.request(
        url,
        {
          method,
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            accept: '*/*',
            ...(options.headers ?? {})
          },
          agent: agentFor(url, options.proxy)
        },
        (res) => {
          const status = res.statusCode ?? 0
          const location = res.headers.location
          if (location && status >= 300 && status < 400) {
            res.resume()
            resolve({
              status,
              body: Buffer.alloc(0),
              headers: { location: Array.isArray(location) ? location[0] : location }
            })
            return
          }

          const chunks: Buffer[] = []
          let received = 0
          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > maxBytes) {
              res.destroy(new Error(`Response exceeded ${maxBytes} bytes`))
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => {
            const headers: Record<string, string> = {}
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') headers[key] = value
              else if (Array.isArray(value)) headers[key] = value.join(', ')
            }
            resolve({ status, body: Buffer.concat(chunks), headers })
          })
          res.on('error', reject)
        }
      )

      timer = setTimeout(() => {
        req.destroy(new Error(`Request timed out after ${deadlineMs}ms`))
      }, remaining)

      req.on('error', reject)

      if (body) req.write(body)
      req.end()
    })

    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      // 301/302/303 demote non-GET requests to GET (they are re-issued
      // without a body); 307/308 preserve both.
      if (result.status === 301 || result.status === 302 || result.status === 303) {
        method = 'GET'
        body = undefined
      }
      currentUrl = new URL(result.headers.location, currentUrl).toString()
      continue
    }

    return result
  }

  throw new Error('Too many redirects')
}

export async function httpJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const result = await httpText(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) }
  })
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status} for ${sanitizeUrl(url)}`)
  }
  return JSON.parse(result.body) as T
}
