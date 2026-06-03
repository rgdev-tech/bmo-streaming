import { getBrowser } from './browser'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const REFERER = 'https://vidlink.pro/'

// Dominios de ads/trackers — los bloqueamos para acelerar y limpiar
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
]

export type StreamResult = {
  url: string
  headers: Record<string, string>
  source: string
}

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

export async function resolveStream(
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

  let found: StreamResult | null = null

  // Capturamos el primer .m3u8 que pida el player (el stream real)
  page.on('request', (req) => {
    const url = req.url()
    if (!found && /\.m3u8(\?|$)/i.test(url)) {
      found = {
        url,
        headers: { Referer: REFERER, 'User-Agent': UA },
        source: 'vidlink',
      }
    }
  })

  // Bloqueamos ads/trackers (rompe los scripts de publicidad)
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (AD_HOSTS.some((h) => url.includes(h))) return route.abort()
    return route.continue()
  })

  try {
    await page.goto(embedUrl(type, tmdbId, season, episode), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Algunos players cargan el m3u8 solo tras interacción
    await page.waitForTimeout(1500)
    try {
      await page.mouse.click(640, 360)
    } catch {
      // sin player visible aún
    }

    const start = Date.now()
    while (!found && Date.now() - start < 20000) {
      await page.waitForTimeout(400)
    }
  } finally {
    await context.close()
  }

  return found
}
