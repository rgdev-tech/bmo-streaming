import { getBrowser } from './browser'
import { PROVIDERS } from './providers'
import type { Provider } from './providers'
import { TTLCache } from './cache'

const STREAM_TTL = 30 * 60 * 1000  // 30 min — CDN tokens suelen expirar antes de 90 min

// Tiempo máximo de carga de la página y de espera para capturar el m3u8.
// En Vercel podemos esperar más; local acortamos para fallar rápido si hay DNS bloqueado.
const PAGE_TIMEOUT = process.env.VERCEL ? 20_000 : 12_000
const STREAM_WAIT  = process.env.VERCEL ? 8_000 : 5_000

const CACHE_FILE = process.env.VERCEL
  ? '/tmp/bmo-streams.json'
  : '.cache/streams.json'
const cache = new TTLCache<StreamResult | null>(STREAM_TTL, CACHE_FILE)

export type Caption = { language: string; url: string; type: string }

export type StreamResult = {
  url: string
  masterContent: string | null      // master m3u8 capturado en el browser
  variantContents: Record<string, string>  // variant m3u8s capturados en el browser (url → contenido)
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

    // Polling: salir en cuanto tengamos el m3u8 (no esperar 7s siempre)
    const result = await new Promise<ReturnType<typeof getResult>>((resolve) => {
      const end = Date.now() + STREAM_WAIT
      const check = () => {
        const r = getResult()
        if (r?.url || Date.now() >= end) { resolve(r); return }
        setTimeout(check, 200)
      }
      check()
    })
    if (!result?.url) {
      console.error(`[${provider.name}] no m3u8 captured after ${STREAM_WAIT}ms`)
      return null
    }

    // Extraer el referer que el CDN realmente espera (puede estar en ?headers= del URL)
    let cdnReferer = provider.referer
    try {
      const u = new URL(result.url)
      const hdrsParam = u.searchParams.get('headers')
      if (hdrsParam) {
        const hdrs = JSON.parse(decodeURIComponent(hdrsParam))
        if (hdrs?.referer) cdnReferer = hdrs.referer
      }
    } catch {}

    // Fetch desde el browser context correcto (bypasea CF bot protection).
    // Intenta desde el iframe de megacloud.live primero (Origin correcto para el CDN),
    // luego desde la página principal.
    const browserFetch = async (url: string): Promise<string | null> => {
      const evalFn = async (u: string, ref: string) => {
        try {
          const r = await fetch(u, { headers: { 'Referer': ref }, cache: 'no-store' })
          if (!r.ok) return `__ERR:${r.status}`
          const text = await r.text()
          return text.trimStart().startsWith('#EXTM3U') ? text : `__BAD:${text.slice(0, 80)}`
        } catch (e: any) { return `__EX:${e?.message}` }
      }

      // Intentar desde el frame que tenga la origin del CDN referer
      const cdnOrigin = new URL(cdnReferer).hostname
      const frames = page.frames()
      for (const frame of frames) {
        try {
          const frameUrl = frame.url()
          if (frameUrl.includes(cdnOrigin)) {
            const result = await frame.evaluate(evalFn, url, cdnReferer)
            if (typeof result === 'string' && result.startsWith('#EXTM3U')) return result
            console.error(`[browser] frame ${cdnOrigin} fetch: ${result}`)
          }
        } catch {}
      }

      // Fallback: main page
      try {
        const result = await page.evaluate(evalFn, url, cdnReferer)
        if (typeof result === 'string' && result.startsWith('#EXTM3U')) return result
        console.error(`[browser] main page fetch: ${result}`)
      } catch {}

      return null
    }

    // Combinar masterContent del provider (si capturó via response) con browserFetch fallback
    let masterContent = result.masterContent ?? null
    // Variantes del provider (capturadas via page.on('response'))
    const variantContents: Record<string, string> = { ...(result.variantContents ?? {}) }

    if (!masterContent) {
      masterContent = await browserFetch(result.url)
      if (masterContent) console.error(`[${provider.name}] master via browserFetch (${masterContent.length}b)`)
      else console.error(`[${provider.name}] browserFetch no capturó master`)
    } else {
      console.error(`[${provider.name}] master via response capture (${masterContent.length}b)`)
    }

    // Si tenemos el master, capturar variantes pendientes via browserFetch
    if (masterContent) {
      const base = result.url.slice(0, result.url.lastIndexOf('/') + 1)
      const origin = new URL(result.url).origin
      for (const line of masterContent.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const abs = t.startsWith('http') ? t : t.startsWith('/') ? `${origin}${t}` : `${base}${t}`
        if (!variantContents[abs]) {
          const content = await browserFetch(abs)
          if (content) {
            variantContents[abs] = content
            console.error(`[${provider.name}] variant via browserFetch: ${abs.slice(-50)}`)
          }
        }
      }
    }

    console.error(`[${provider.name}] cdnReferer: ${cdnReferer}, variants: ${Object.keys(variantContents).length}`)

    return {
      url: result.url,
      masterContent,
      variantContents,
      captions: result.captions,
      headers: { Referer: cdnReferer },
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

// Corre providers con concurrencia limitada para no agotar memoria en Vercel.
// MAX_CONCURRENT = 2 evita que múltiples contextos de Chromium crasheen el proceso.
const MAX_CONCURRENT = process.env.VERCEL ? 2 : 4

async function raceProviders(
  providers: Provider[],
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  if (providers.length === 0) return Promise.resolve(null)

  // Slot semaphore: solo MAX_CONCURRENT corriendo a la vez
  let slots = MAX_CONCURRENT
  let resolved = false
  let remaining = providers.length
  const queue = [...providers]

  return new Promise((resolve) => {
    function tryNext() {
      while (slots > 0 && queue.length > 0 && !resolved) {
        const provider = queue.shift()!
        slots--
        tryProvider(provider, type, tmdbId, season, episode)
          .then((result) => {
            slots++
            if (result && !resolved) {
              resolved = true
              console.error(`[scrape] ${provider.name} OK → ${result.url.slice(0, 80)}`)
              resolve(result)
              return
            }
            if (!result) console.error(`[scrape] ${provider.name} → null`)
            if (--remaining === 0 && !resolved) { resolved = true; resolve(null) }
            tryNext()
          })
          .catch(() => {
            slots++
            if (--remaining === 0 && !resolved) { resolved = true; resolve(null) }
            tryNext()
          })
      }
    }
    tryNext()
  })
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  // Agrupar por tier y correr cada tier en paralelo (primer éxito gana dentro del tier)
  const byTier = new Map<number, Provider[]>()
  for (const p of PROVIDERS) {
    const tier = p.tier ?? 99
    const list = byTier.get(tier) ?? []
    list.push(p)
    byTier.set(tier, list)
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b)

  for (const tier of tiers) {
    const providers = byTier.get(tier)!
    console.error(`[scrape] tier ${tier}: ${providers.map((p) => p.name).join(', ')}`)
    const result = await raceProviders(providers, type, tmdbId, season, episode)
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
