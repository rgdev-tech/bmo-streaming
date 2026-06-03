import { getBrowser } from './browser'
import { TTLCache } from './cache'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const REFERER = 'https://vidlink.pro/'
const STREAM_TTL = 20 * 60 * 1000

const AD_HOSTS = [
  'doubleclick',
  'googlesyndication',
  'google-analytics',
  'googletagmanager',
  'adservice',
  'popads',
  'propellerads',
  'onclicka',
  'adsterra',
  'histats',
  'sharethis',
  'pippio',
  'lijit',
  'crwdcntrl',
  'rlcdn',
  'tynt',
  'dtscout',
  'mountain.com',
  'yandex',
]

const BLOCKED_RESOURCES = new Set(['image', 'font', 'stylesheet', 'media'])

export type Caption = {
  language: string
  url: string
  type: string
}

export type StreamResult = {
  url: string
  captions: Caption[]
  headers: Record<string, string>
  source: string
}

const cache = new TTLCache<StreamResult | null>(STREAM_TTL)

function embedUrl(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
) {
  if (type === 'tv' && season != null && episode != null) {
    return `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`
  }
  return `https://vidlink.pro/movie/${tmdbId}`
}

async function scrape(
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

  let apiJson: any = null
  let fallbackM3u8 = ''

  // Fallback: capturamos el m3u8 de la red por si la API cambia
  page.on('request', (req) => {
    const url = req.url()
    if (!fallbackM3u8 && /\.m3u8(\?|$)/i.test(url)) fallbackM3u8 = url
  })

  // Un solo handler: bloquea ads/recursos, intercepta la API (multiLang=1)
  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()

    if (AD_HOSTS.some((h) => url.includes(h))) return route.abort()
    if (BLOCKED_RESOURCES.has(req.resourceType())) return route.abort()

    // Forzamos multiLang=1 en la API de vidlink → trae subtítulos
    if (url.includes('/api/b/')) {
      try {
        const newUrl = url.replace('multiLang=0', 'multiLang=1')
        const resp = await route.fetch({ url: newUrl })
        const body = await resp.text()
        try {
          apiJson = JSON.parse(body)
        } catch {
          // respuesta no-JSON
        }
        return route.fulfill({ response: resp, body })
      } catch {
        return route.continue()
      }
    }

    return route.continue()
  })

  try {
    await page.goto(embedUrl(type, tmdbId, season, episode), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    const start = Date.now()
    while (!apiJson && !fallbackM3u8 && Date.now() - start < 20000) {
      await page.waitForTimeout(300)
    }
    // Damos un margen extra para que llegue la API si ya hubo m3u8
    if (!apiJson && fallbackM3u8) await page.waitForTimeout(1500)
  } finally {
    await context.close()
  }

  const playlist: string | undefined = apiJson?.stream?.playlist
  const url = playlist || fallbackM3u8
  if (!url) return null

  // Validamos que el playlist tenga video real (vidlink "resuelve" títulos
  // que no tiene, devolviendo un m3u8 vacío/roto)
  try {
    const check = await fetch(url, {
      headers: { Referer: REFERER, 'User-Agent': UA },
    })
    if (!check.ok) return null
    const text = await check.text()
    if (!/#EXT-X-STREAM-INF|#EXTINF/.test(text)) return null
  } catch {
    return null
  }

  const rawCaptions: any[] = apiJson?.stream?.captions ?? []
  const captions: Caption[] = rawCaptions
    .filter((c) => c?.url && c?.language)
    .map((c) => ({ language: c.language, url: c.url, type: c.type ?? 'vtt' }))

  return { url, captions, headers: { Referer: REFERER, 'User-Agent': UA }, source: 'vidlink' }
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
