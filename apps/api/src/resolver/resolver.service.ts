import { getBrowser } from './browser'
import { TTLCache } from './cache'
import { PROVIDERS, type Provider, type Caption } from './providers'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const STREAM_TTL = 20 * 60 * 1000

export type { Caption }

export type StreamResult = {
  url: string
  captions: Caption[]
  headers: Record<string, string>
  source: string
}

const cache = new TTLCache<StreamResult | null>(STREAM_TTL)

// Valida que el playlist tenga video real (algunos proveedores "resuelven"
// títulos que no tienen, devolviendo un m3u8 vacío)
async function isPlayable(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers })
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
  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 },
    locale: 'es-ES',
  })
  const page = await context.newPage()

  let result: StreamResult | null = null
  try {
    const getResult = await provider.attach(page)
    await page.goto(provider.embed(type, tmdbId, season, episode), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    await page.waitForTimeout(1000)
    try {
      await page.mouse.click(640, 360)
    } catch {}

    const start = Date.now()
    while (!getResult() && Date.now() - start < 15000) {
      await page.waitForTimeout(300)
    }

    const captured = getResult()
    if (captured) {
      const headers = { Referer: provider.referer, 'User-Agent': UA }
      if (await isPlayable(captured.url, headers)) {
        result = {
          url: captured.url,
          captions: captured.captions,
          headers,
          source: provider.name,
        }
      }
    }
  } catch {
    result = null
  } finally {
    await context.close()
  }

  return result
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  // Intenta cada proveedor en orden hasta encontrar un stream reproducible
  for (const provider of PROVIDERS) {
    const result = await tryProvider(provider, type, tmdbId, season, episode)
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
  const key =
    type === 'tv' ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`
  return cache.resolve(key, () => scrape(type, tmdbId, season, episode))
}
