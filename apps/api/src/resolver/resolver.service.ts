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

// Verifica que el m3u8 capturado realmente sirva: debe responder 200 y empezar
// con #EXTM3U. Así descartamos streams rotos/de ads que dejan la pantalla negra
// y dejamos que scrape() siga con otro proveedor.
async function isPlayable(url: string, headers: Record<string, string>): Promise<boolean> {
  try {
    // Solo pedimos los primeros KB: el manifiesto HLS es pequeño y así validamos
    // en milisegundos en vez de descargar todo el playlist.
    const res = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-2047' },
      redirect: 'follow',
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok && res.status !== 206) return false
    const text = await res.text()
    return text.trimStart().startsWith('#EXTM3U')
  } catch {
    return false
  }
}

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
    await page.waitForTimeout(250)
    try { await page.mouse.click(640, 360) } catch {}

    // Espera hasta que el proveedor capture el m3u8 (máx 10s).
    // Polling rápido (100ms) para salir en cuanto aparezca → menor latencia.
    const start = Date.now()
    while (!getResult() && Date.now() - start < 10000) {
      await page.waitForTimeout(100)
    }

    const captured = getResult()
    console.error(`[${provider.name}] captured:`, captured?.url ?? 'null')
    if (captured) {
      const headers = { Referer: provider.referer, 'User-Agent': UA }
      // Solo aceptamos el stream si realmente es reproducible (evita pantalla negra)
      if (await isPlayable(captured.url, headers)) {
        result = { url: captured.url, captions: captured.captions, headers, source: provider.name }
      } else {
        console.error(`[${provider.name}] m3u8 no reproducible → descartado`)
      }
    }
  } catch (e) {
    console.error(`[${provider.name}] scrape error:`, e)
    result = null
  } finally {
    try { await context.close() } catch {}
  }

  return result
}

// Concurrencia: en local lanzamos varios proveedores a la vez (el más rápido
// gana → menor latencia). En Vercel somos conservadores para no agotar RAM.
const CONCURRENCY = process.env.VERCEL ? 2 : 4

// Corre un grupo de proveedores en paralelo (limitado por CONCURRENCY).
// Devuelve el primero que dé un stream reproducible.
async function raceGroup(
  providers: Provider[],
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  let resolved = false
  let active = 0
  let index = 0

  return new Promise((resolve) => {
    function next() {
      if (resolved) return
      if (index >= providers.length && active === 0) {
        resolve(null)
        return
      }
      while (active < CONCURRENCY && index < providers.length) {
        const provider = providers[index++]
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

// Prueba los proveedores tier por tier: solo pasa al siguiente tier si todo
// el anterior falló. Así los rápidos/confiables (tier 1) responden primero
// y los de respaldo solo se usan cuando hacen falta.
async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const tiers = [...new Set(PROVIDERS.map((p) => p.tier ?? 1))].sort((a, b) => a - b)
  for (const tier of tiers) {
    const group = PROVIDERS.filter((p) => (p.tier ?? 1) === tier)
    const result = await raceGroup(group, type, tmdbId, season, episode)
    if (result) return result
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
