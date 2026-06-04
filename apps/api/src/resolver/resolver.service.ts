import { getBrowser } from './browser'
import { PROVIDERS } from './providers'
import type { Provider } from './providers'
import { TTLCache } from './cache'

const STREAM_TTL = 90 * 60 * 1000

// Tiempo máximo de carga de la página y de espera para capturar el m3u8
const PAGE_TIMEOUT = 20_000
const STREAM_WAIT  = 7_000

const CACHE_FILE = process.env.VERCEL
  ? '/tmp/bmo-streams.json'
  : '.cache/streams.json'
const cache = new TTLCache<StreamResult | null>(STREAM_TTL, CACHE_FILE)

export type Caption = { language: string; url: string; type: string }

export type StreamResult = {
  url: string
  captions: Caption[]
  headers: Record<string, string>
  source: string
}

export type ProviderHealth = {
  name: string
  tier: number
  ok: boolean
  ms: number
}

async function tryProvider(
  provider: Provider,
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  let context: any = null
  try {
    const browser = await getBrowser()
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()
    const embedUrl = provider.embed(type, tmdbId, season, episode)

    // attach ANTES de navegar para que los handlers de red ya estén activos
    const getResult = await provider.attach(page)

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT })
    await page.waitForTimeout(STREAM_WAIT)

    const result = getResult()
    if (!result?.url) return null

    return {
      url: result.url,
      captions: result.captions,
      headers: { Referer: provider.referer },
      source: provider.name,
    }
  } catch (e) {
    console.error(`[${provider.name}] error:`, String((e as Error)?.message ?? e).slice(0, 120))
    return null
  } finally {
    if (context) {
      try { await context.close() } catch {}
    }
  }
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  // Tier 1 primero, dentro de cada tier mantiene el orden del array
  const sorted = [...PROVIDERS].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99))

  for (const provider of sorted) {
    console.error(`[scrape] trying ${provider.name} (tier ${provider.tier ?? '?'})`)
    const result = await tryProvider(provider, type, tmdbId, season, episode)
    if (result) {
      console.error(`[scrape] ${provider.name} OK → ${result.url.slice(0, 80)}`)
      return result
    }
  }

  return null
}

export function resolveStream(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const key = type === 'tv' ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`
  return cache.resolve(key, () => scrape(type, tmdbId, season, episode))
}

// Prueba cada provider con Fight Club (TMDB 550) — útil para diagnosticar caídas
export async function checkProviders(): Promise<ProviderHealth[]> {
  const TEST_ID = 550
  const results: ProviderHealth[] = []
  for (const p of PROVIDERS) {
    const start = Date.now()
    let ok = false
    try {
      ok = !!(await tryProvider(p, 'movie', TEST_ID))
    } catch {
      ok = false
    }
    results.push({ name: p.name, tier: p.tier ?? 99, ok, ms: Date.now() - start })
  }
  return results
}
