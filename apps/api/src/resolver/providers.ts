import type { Page } from 'playwright-core'

export type Caption = { language: string; url: string; type: string }
export type ProviderResult = { url: string; captions: Caption[] }

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

// Captura genérica: toma el primer .m3u8 que aparezca en la red.
// Sirve para la mayoría de embeds que cargan HLS directamente.
function m3u8Sniffer(name: string, referer: string, tier: number, embedFn: Provider['embed']): Provider {
  return {
    name,
    referer,
    tier,
    embed: embedFn,
    attach: async (page) => {
      let m3u8 = ''
      page.on('request', (req) => {
        const u = req.url()
        if (!m3u8 && /\.m3u8(\?|$)/i.test(u)) m3u8 = u
      })
      await blockAds(page)
      return () => (m3u8 ? { url: m3u8, captions: [] } : null)
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
      page.on('request', (req) => {
        const u = req.url()
        if (!fallback && /\.m3u8(\?|$)/i.test(u)) fallback = u
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
        return { url, captions }
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
]
