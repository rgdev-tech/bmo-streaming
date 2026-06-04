import { TTLCache } from './cache'
import { PROVIDERS, type Provider, type Caption } from './providers'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Links HLS de estos proveedores duran 4-8h; el TTL de 20min era demasiado corto.
const STREAM_TTL = 4 * 60 * 60 * 1000

export type { Caption }

export type StreamResult = {
  url: string
  captions: Caption[]
  headers: Record<string, string>
  source: string
}

// Persiste a disco para sobrevivir reinicios: /tmp en Vercel, .cache en local
const CACHE_FILE = process.env.VERCEL
  ? '/tmp/bmo-streams.json'
  : '.cache/streams.json'
const cache = new TTLCache<StreamResult | null>(STREAM_TTL, CACHE_FILE)


async function tryProvider(
  provider: Provider,
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const { getBrowser } = await import('./browser')
  let browser: Awaited<ReturnType<typeof getBrowser>>
  try {
    browser = await getBrowser()
  } catch (e) {
    console.error(`[${provider.name}] getBrowser failed:`, e)
    return null
  }
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 },
    locale: 'es-ES',
    // Bloquea imágenes y media a nivel de contexto para mayor velocidad
    javaScriptEnabled: true,
  })
  const page = await context.newPage()

  // Bloquea recursos pesados que no necesitamos antes de ir a la URL
  await context.route(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot)(\?.*)?$/i, (r) => r.abort())

  let result: StreamResult | null = null
  try {
    const getResult = await provider.attach(page)
    await page.goto(provider.embed(type, tmdbId, season, episode), {
      waitUntil: 'domcontentloaded',
      timeout: 22000,
    })

    // Clic para activar el player (algunos requieren interacción del usuario)
    await page.waitForTimeout(500)
    try { await page.mouse.click(640, 360) } catch {}

    // Espera hasta que el proveedor capture el m3u8 (máx 12s)
    const start = Date.now()
    while (!getResult() && Date.now() - start < 12000) {
      await page.waitForTimeout(200)
    }

    const captured = getResult()
    console.error(`[${provider.name}] captured:`, captured?.url ?? 'null')
    if (captured) {
      const headers = { Referer: provider.referer, 'User-Agent': UA }
      result = { url: captured.url, captions: captured.captions, headers, source: provider.name }
    }
  } catch (e) {
    console.error(`[${provider.name}] scrape error:`, e)
    result = null
  } finally {
    try { await context.close() } catch {}
  }

  return result
}

// Corre proveedores con concurrencia limitada (máx 2 simultáneos) para evitar OOM.
// Devuelve el primero que tenga éxito.
async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const CONCURRENCY = 2
  let resolved = false
  let active = 0
  let index = 0

  return new Promise((resolve) => {
    function next() {
      if (resolved) return
      if (index >= PROVIDERS.length && active === 0) {
        resolve(null)
        return
      }
      while (active < CONCURRENCY && index < PROVIDERS.length) {
        const provider = PROVIDERS[index++]
        active++
        tryProvider(provider, type, tmdbId, season, episode).then((result) => {
          active--
          if (!resolved && result) {
            resolved = true
            resolve(result)
          } else {
            next()
          }
        })
      }
    }
    next()
  })
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

export type ProviderHealth = {
  name: string
  tier: number
  ok: boolean
  ms: number
}

// Prueba cada proveedor individualmente con un título siempre disponible
// (Fight Club, TMDB 550). Útil para diagnosticar cuáles están caídos.
export async function checkProviders(): Promise<ProviderHealth[]> {
  const TEST_ID = 550
  return Promise.all(
    PROVIDERS.map(async (p) => {
      const start = Date.now()
      let ok = false
      try {
        ok = !!(await tryProvider(p, 'movie', TEST_ID))
      } catch {
        ok = false
      }
      return { name: p.name, tier: p.tier ?? 1, ok, ms: Date.now() - start }
    })
  )
}
