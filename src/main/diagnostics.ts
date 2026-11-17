import net from 'node:net'
import type { DiagnosticResult } from '../shared/types.ts'
import { httpText } from './net/http.ts'
import { providers } from './providers/registry.ts'
import { settings } from './settings.ts'

function probeTcp(host: string, port: number, timeout = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout, () => done(false))
    socket.once('error', () => done(false))
    socket.once('connect', () => done(true))
    socket.connect(port, host)
  })
}

function parseTracker(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url.replace(/^udp:/, 'http:').replace(/^wss:/, 'https:'))
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    return { host: parsed.hostname, port }
  } catch {
    return null
  }
}

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  const proxy = settings.get().proxy

  // 1. Index providers
  const providerChecks = await Promise.all(
    providers.map(async (provider) => {
      const started = Date.now()
      try {
        const health = await provider.health({ proxy })
        return {
          name: `Index: ${provider.name}`,
          ok: health.reachable,
          detail: health.reachable
            ? `reachable in ${health.latencyMs}ms`
            : (health.error ?? 'unreachable'),
          durationMs: health.latencyMs ?? Date.now() - started,
          category: 'index' as const
        }
      } catch (error) {
        return {
          name: `Index: ${provider.name}`,
          ok: false,
          detail: (error as Error).message,
          durationMs: Date.now() - started,
          category: 'index' as const
        }
      }
    })
  )
  results.push(...providerChecks)

  // 2. Trackers (TCP reachability; UDP trackers can't be probed this way)
  const trackers = settings.get().trackers.slice(0, 6)
  const trackerChecks = await Promise.all(
    trackers.map(async (tracker) => {
      // UDP trackers speak no TCP — probing them over TCP proves nothing.
      if (/^udp:/i.test(tracker.trim())) {
        return {
          name: `Tracker: ${tracker}`,
          ok: true,
          detail: 'skipped — UDP tracker (no TCP probe possible)',
          durationMs: 0,
          category: 'tracker' as const
        }
      }
      const target = parseTracker(tracker)
      if (!target) {
        return {
          name: `Tracker: ${tracker}`,
          ok: false,
          detail: 'unparseable url',
          durationMs: 0,
          category: 'tracker' as const
        }
      }
      const started = Date.now()
      const ok = await probeTcp(target.host, target.port)
      return {
        name: `Tracker: ${target.host}:${target.port}`,
        ok,
        detail: ok ? 'TCP reachable' : 'TCP blocked or timed out',
        durationMs: Date.now() - started,
        category: 'tracker' as const
      }
    })
  )
  results.push(...trackerChecks)

  // 3. YouTube
  {
    const started = Date.now()
    try {
      const body = await httpText('https://www.youtube.com/results?search_query=ptm', {
        proxy,
        timeout: 12000
      })
      results.push({
        name: 'YouTube',
        ok: body.status === 200,
        detail: body.status === 200 ? 'reachable' : `HTTP ${body.status}`,
        durationMs: Date.now() - started,
        category: 'youtube'
      })
    } catch (error) {
      results.push({
        name: 'YouTube',
        ok: false,
        detail: (error as Error).message,
        durationMs: Date.now() - started,
        category: 'youtube'
      })
    }
  }

  // 4. Metadata source
  {
    const started = Date.now()
    const key = settings.get().tmdbApiKey
    results.push({
      name: 'TMDB metadata',
      ok: Boolean(key),
      detail: key ? 'API key configured' : 'no API key — posters and genres disabled',
      durationMs: Date.now() - started,
      category: 'metadata'
    })
  }

  // 5. Proxy state
  if (proxy.enabled) {
    results.push({
      name: 'Proxy',
      ok: true,
      detail: `${proxy.type}://${proxy.host}:${proxy.port} (torrent TCP traffic tunnelled; UDP trackers/DHT not supported)`,
      durationMs: 0,
      category: 'proxy' as const
    })
  }

  return results
}
