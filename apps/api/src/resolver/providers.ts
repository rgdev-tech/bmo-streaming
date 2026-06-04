import type { Page } from 'playwright-core'

export type Caption = { language: string; url: string; type: string }
export type ProviderResult = { url: string; captions: Caption[] }

export type Provider = {
  name: string
  referer: string
  embed: (type: 'movie' | 'tv', id: number, season?: number, episode?: number) => string
  // Configura listeners/rutas en la página; devuelve un getter del resultado capturado
  attach: (page: Page) => Promise<() => ProviderResult | null>
}

const AD_HOSTS = [
  'doubleclick', 'googlesyndication', 'google-analytics', 'googletagmanager',
  'adservice', 'popads', 'propellerads', 'onclicka', 'adsterra', 'histats',
  'sharethis', 'pippio', 'lijit', 'crwdcntrl', 'rlcdn', 'tynt', 'dtscout',
  'mountain.com', 'yandex',
]

const BLOCKED_RESOURCES = new Set(['image', 'font', 'stylesheet', 'media'])

function blockAds(page: Page, extra?: (url: string, route: any) => boolean | Promise<boolean>) {
  return page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    if (AD_HOSTS.some((h) => url.includes(h))) return route.abort()
    if (BLOCKED_RESOURCES.has(req.resourceType())) return route.abort()
    if (extra && (await extra(url, route))) return
    return route.continue()
  })
}

export const PROVIDERS: Provider[] = [
  // vidlink: fuente primaria, trae subtítulos vía su API (multiLang=1)
  {
    name: 'vidlink',
    referer: 'https://vidlink.pro/',
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
            try {
              apiJson = JSON.parse(body)
            } catch {}
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

  // videasy: respaldo. Captura el m3u8 de la red (sin subtítulos)
  {
    name: 'videasy',
    referer: 'https://player.videasy.net/',
    embed: (type, id, s, e) =>
      type === 'tv'
        ? `https://player.videasy.net/tv/${id}/${s}/${e}`
        : `https://player.videasy.net/movie/${id}`,
    attach: async (page) => {
      let m3u8 = ''
      page.on('request', (req) => {
        const u = req.url()
        if (!m3u8 && /\.m3u8(\?|$)/i.test(u)) m3u8 = u
      })
      await blockAds(page)
      return () => (m3u8 ? { url: m3u8, captions: [] } : null)
    },
  },
]
