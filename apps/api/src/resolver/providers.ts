import type { Page } from 'playwright-core'

export type Caption = { language: string; url: string; type: string }
export type ProviderResult = {
  url: string
  captions: Caption[]
  masterContent?: string | null
  variantContents?: Record<string, string>
  streamReferer?: string
}

export type Provider = {
  name: string
  referer: string
  // tier 1 = primarios (corren primero, en paralelo).
  // tier 2+ = respaldo (solo si todo el tier anterior falla).
  tier?: number
  embed: (type: 'movie' | 'tv', id: number, season?: number, episode?: number) => string
  attach: (page: Page) => Promise<() => ProviderResult | null>
}

const AD_HOSTS = [
  'doubleclick', 'googlesyndication', 'google-analytics', 'googletagmanager',
  'adservice', 'popads', 'propellerads', 'onclicka', 'adsterra', 'histats',
  'sharethis', 'pippio', 'lijit', 'crwdcntrl', 'rlcdn', 'tynt', 'dtscout',
  'mountain.com', 'yandex', 'outbrain', 'taboola', 'prebid', 'pubmatic',
  'rubiconproject', 'openx', 'appnexus', 'criteo', 'adsrvr', 'casalemedia',
]

const BLOCKED_TYPES = new Set(['image', 'font', 'stylesheet', 'media', 'ping', 'beacon'])

function blockAds(page: Page, extra?: (url: string, route: any) => boolean | Promise<boolean>) {
  return page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    if (AD_HOSTS.some((h) => url.includes(h))) return route.abort()
    if (BLOCKED_TYPES.has(req.resourceType())) return route.abort()
    if (extra) {
      const handled = await extra(url, route)
      if (handled) return
    }
    return route.continue()
  })
}

// Descarta .m3u8 que NO son el stream principal (publicidad, miniaturas, etc.)
const M3U8_JUNK = /thumbnail|sprite|storyboard|preview|\/ads?[\/_-]|advert|trailer|promo/i
// Pistas de que es el playlist principal (mayor prioridad)
const M3U8_MAIN = /master|index|playlist|stream|manifest/i

function isM3u8(u: string): boolean {
  return /\.m3u8(\?|$)/i.test(u) && !M3U8_JUNK.test(u)
}

// Captura genérica de HLS. Recoge TODOS los .m3u8 válidos que pasen por la red
// y captura el contenido del master desde la respuesta del browser (evita fetch server-side bloqueado).
function m3u8Sniffer(name: string, referer: string, tier: number, embedFn: Provider['embed']): Provider {
  return {
    name,
    referer,
    tier,
    embed: embedFn,
    attach: async (page) => {
      const found: string[] = []
      const contents = new Map<string, string>()
      const requestReferers = new Map<string, string>()

      const captureUrl = (u: string) => {
        if (isM3u8(u) && !found.includes(u)) found.push(u)
      }
      page.on('request', (req) => {
        const u = req.url()
        captureUrl(u)
        if (isM3u8(u)) {
          const ref = req.headers()['referer']
          if (ref) requestReferers.set(u, ref)
        }
      })
      page.on('response', async (res) => {
        const u = res.url()
        captureUrl(u)
        if (isM3u8(u) && !contents.has(u)) {
          try {
            const body = await res.text()
            if (body.trimStart().startsWith('#EXTM3U')) contents.set(u, body)
          } catch {}
        }
      })
      await blockAds(page)
      return () => {
        if (!found.length) return null
        const main = found.find((u) => M3U8_MAIN.test(u)) ?? found[0]
        return {
          url: main,
          captions: [],
          masterContent: contents.get(main) ?? null,
          streamReferer: requestReferers.get(main),
        }
      }
    },
  }
}

export const PROVIDERS: Provider[] = [
  // ─── TIER 1: primarios (rápidos y confiables, en paralelo) ───

  // vidlink: fuente primaria — subtítulos multi-idioma vía su API
  {
    name: 'vidlink',
    referer: 'https://vidlink.pro/',
    tier: 1,
    embed: (type, id, s, e) =>
      type === 'tv'
        ? `https://vidlink.pro/tv/${id}/${s}/${e}`
        : `https://vidlink.pro/movie/${id}`,
    attach: async (page) => {
      let apiJson: any = null
      let fallback = ''
      let fallbackReferer = ''
      let capturedMaster: string | null = null
      const capturedVariants = new Map<string, string>()

      page.on('request', (req) => {
        const u = req.url()
        if (!fallback && isM3u8(u)) {
          fallback = u
          fallbackReferer = req.headers()['referer'] ?? ''
        }
      })
      page.on('response', async (res) => {
        const u = res.url()
        if (!fallback && isM3u8(u)) fallback = u
        // Capturar contenido m3u8 del browser — este es el que puede bypassear CF bot protection
        if (isM3u8(u) && !capturedVariants.has(u)) {
          try {
            const body = await res.text()
            if (body.trimStart().startsWith('#EXTM3U')) {
              if (!capturedMaster) capturedMaster = body
              capturedVariants.set(u, body)
            }
          } catch {}
        }
      })
      await blockAds(page, async (url, route) => {
        if (url.includes('/api/b/')) {
          try {
            const newUrl = url.replace('multiLang=0', 'multiLang=1')
            const resp = await route.fetch({ url: newUrl })
            const body = await resp.text()
            try { apiJson = JSON.parse(body) } catch {}
            await route.fulfill({ response: resp, body })
          } catch {
            await route.continue()
          }
          return true
        }
        return false
      })
      return () => {
        const playlist: string | undefined = apiJson?.stream?.playlist
        const url = playlist || fallback
        if (!url) return null
        const raw: any[] = apiJson?.stream?.captions ?? []
        const captions: Caption[] = raw
          .filter((c) => c?.url && c?.language)
          .map((c) => ({ language: c.language, url: c.url, type: c.type ?? 'vtt' }))
        // streamReferer: el que el browser usó al pedir el CDN
        const streamReferer = fallbackReferer || undefined
        // masterContent: capturado directo de la respuesta del browser (bypasea CF)
        const masterContent = capturedMaster
        // variantContents: todas las variantes capturadas
        const variantContents: Record<string, string> = Object.fromEntries(capturedVariants)
        console.error(`[vidlink] capturedMaster: ${masterContent ? masterContent.length + 'b' : 'null'}, variants: ${capturedVariants.size}`)
        return { url, captions, streamReferer, masterContent, variantContents }
      }
    },
  },

  // videasy: segundo primario — captura m3u8 de red
  m3u8Sniffer('videasy', 'https://player.videasy.net/', 1, (type, id, s, e) =>
    type === 'tv'
      ? `https://player.videasy.net/tv/${id}/${s}/${e}`
      : `https://player.videasy.net/movie/${id}`
  ),

  m3u8Sniffer('vidsrc.to', 'https://vidsrc.to/', 1, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.to/embed/movie/${id}`
  ),

  m3u8Sniffer('superembed', 'https://superembed.stream/', 1, (type, id, s, e) =>
    type === 'tv'
      ? `https://superembed.stream/embed?tmdb=1&tv=1&id=${id}&season=${s}&episode=${e}`
      : `https://superembed.stream/embed?tmdb=1&id=${id}`
  ),

  // ─── TIER 2: respaldo ───

  m3u8Sniffer('embed.su', 'https://embed.su/', 2, (type, id, s, e) =>
    type === 'tv'
      ? `https://embed.su/embed/tv/${id}/${s}/${e}`
      : `https://embed.su/embed/movie/${id}`
  ),

  m3u8Sniffer('autoembed', 'https://autoembed.cc/', 2, (type, id, s, e) =>
    type === 'tv'
      ? `https://autoembed.cc/tv/tmdb/${id}/${s}/${e}`
      : `https://autoembed.cc/movie/tmdb/${id}`
  ),

  m3u8Sniffer('vidsrc.cc', 'https://vidsrc.cc/', 2, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.cc/v2/embed/movie/${id}`
  ),

  m3u8Sniffer('2embed', 'https://www.2embed.cc/', 2, (type, id, s, e) =>
    type === 'tv'
      ? `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`
      : `https://www.2embed.cc/embed/${id}`
  ),

  m3u8Sniffer('moviesapi', 'https://moviesapi.club/', 2, (type, id, s, e) =>
    type === 'tv'
      ? `https://moviesapi.club/tv/${id}-${s}-${e}`
      : `https://moviesapi.club/movie/${id}`
  ),

  // ─── TIER 3: respaldo extendido (solo si tiers 1 y 2 fallan) ───

  m3u8Sniffer('vidsrc.xyz', 'https://vidsrc.xyz/', 3, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
      : `https://vidsrc.xyz/embed/movie?tmdb=${id}`
  ),

  m3u8Sniffer('vidsrc.net', 'https://vidsrc.net/', 3, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidsrc.net/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.net/embed/movie/${id}`
  ),

  m3u8Sniffer('smashystream', 'https://embed.smashystream.com/', 3, (type, id, s, e) =>
    type === 'tv'
      ? `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}`
      : `https://embed.smashystream.com/playere.php?tmdb=${id}`
  ),

  m3u8Sniffer('vidfast', 'https://vidfast.pro/', 3, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidfast.pro/tv/${id}/${s}/${e}`
      : `https://vidfast.pro/movie/${id}`
  ),

  m3u8Sniffer('vidjoy', 'https://vidjoy.pro/', 3, (type, id, s, e) =>
    type === 'tv'
      ? `https://vidjoy.pro/embed/tv/${id}/${s}/${e}`
      : `https://vidjoy.pro/embed/movie/${id}`
  ),
]
