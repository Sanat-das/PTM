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
  timeout?: number
  proxy?: ProxyConfig
  maxRedirects?: number
  method?: string
  body?: string
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
  let currentUrl = rawUrl

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const url = new URL(currentUrl)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http

    const result = await new Promise<HttpBufferResult>((resolve, reject) => {
      const req = transport.request(
        url,
        {
          method: options.method ?? 'GET',
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
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
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

      req.setTimeout(options.timeout ?? 15000, () => {
        req.destroy(new Error(`Request timed out after ${options.timeout ?? 15000}ms`))
      })
      req.on('error', reject)

      if (options.body) req.write(options.body)
      req.end()
    })

    if (result.status >= 300 && result.status < 400 && result.headers.location) {
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
    throw new Error(`HTTP ${result.status} for ${url}`)
  }
  return JSON.parse(result.body) as T
}
