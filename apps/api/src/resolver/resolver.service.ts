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

const cache = new TTLCache<StreamResult | null>(STREAM_TTL)

async function isPlayable(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return false
    const text = await res.text()
    return /#EXT-X-STREAM-INF|#EXTINF/.test(text)
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
      const playable = await isPlayable(captured.url, headers)
      console.error(`[${provider.name}] playable:`, playable)
      if (playable) {
        result = { url: captured.url, captions: captured.captions, headers, source: provider.name }
      }
    }
  } catch (e) {
    console.error(`[${provider.name}] scrape error:`, e)
    result = null
  } finally {
    await context.close()
  }

  return result
}

// Lanza todos los proveedores en paralelo y devuelve el primero que tenga éxito.
// Lanza un grupo de proveedores en paralelo; devuelve el primero con éxito.
async function raceTier(
  providers: Provider[],
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  if (providers.length === 0) return null
  try {
    return await Promise.any(
      providers.map(async (provider) => {
        const result = await tryProvider(provider, type, tmdbId, season, episode)
        if (!result) throw new Error(`${provider.name}: no stream`)
        return result
      })
    )
  } catch {
    return null
  }
}

// Fallback por tiers: cada tier corre en paralelo; si todo el tier falla,
// pasa al siguiente. Evita lanzar todos los browsers a la vez.
async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  // Agrupar proveedores por su tier (default = 1)
  const tiers = new Map<number, Provider[]>()
  for (const p of PROVIDERS) {
    const t = p.tier ?? 1
    if (!tiers.has(t)) tiers.set(t, [])
    tiers.get(t)!.push(p)
  }

  // Recorrer tiers en orden ascendente
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    const result = await raceTier(tiers.get(tier)!, type, tmdbId, season, episode)
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
