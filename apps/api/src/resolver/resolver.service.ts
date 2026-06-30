import {
  makeProviders,
  makeStandardFetcher,
  makeSimpleProxyFetcher,
  targets,
  type ScrapeMedia,
  type RunOutput,
} from '@p-stream/providers'
import { TTLCache } from './cache'
import { tmdbService } from '../tmdb/tmdb.service'

const STREAM_TTL = 30 * 60 * 1000  // 30 min — los tokens del CDN suelen expirar antes de 90 min

// Proxy opcional (Cloudflare Worker en apps/proxy). Si STREAM_PROXY_URL está
// definido, los scrapers que requieren CORS/headers especiales pasan por él.
const PROXY_URL = process.env.STREAM_PROXY_URL

const CACHE_FILE = process.env.VERCEL
  ? '/tmp/bmo-streams.json'
  : '.cache/streams.json'
const cache = new TTLCache<StreamResult | null>(STREAM_TTL, CACHE_FILE)

export type Caption = { language: string; url: string; type: string }

export type StreamResult = {
  url: string                          // m3u8 (hls) o mp4 (file) — URL directa del CDN
  type: 'hls' | 'file'
  captions: Caption[]
  headers: Record<string, string>      // headers que el CDN espera (Referer/Origin/etc.)
  source: string
}

export type ProviderHealth = {
  name: string
  tier: number
  ok: boolean
  ms: number
}

// La librería (bundleada por esbuild) crea AbortSignals de una clase distinta a la
// del fetch nativo de Node (undici) → "Expected signal to be an instance of AbortSignal".
// Envolvemos fetch para descartar ese signal foráneo y usar un timeout nativo propio.
const FETCH_TIMEOUT = 8_000
const safeFetch: typeof fetch = ((url: any, init: any = {}) => {
  const { signal: _foreign, ...rest } = init ?? {}
  return fetch(url, { ...rest, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
}) as typeof fetch

// Cliente de @movie-web/providers — scraping por HTTP puro (sin navegador).
// target NATIVE: devuelve URLs de stream directas, ideal para apps nativas.
const providers = makeProviders({
  fetcher: makeStandardFetcher(safeFetch),
  proxiedFetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, safeFetch) : undefined,
  target: targets.NATIVE,
  consistentIpForRequests: true,
})

// Fuentes que devuelven mp4 H.265 con tag `hev1` — iOS/AVPlayer reproduce el audio
// pero NO el video. Las mandamos al final para preferir HLS/H.264 (compatible).
const DEPRIORITIZED = new Set(['vidlink'])

// Orden de fuentes: todas por rank desc, pero las deprioritizadas al final.
const SOURCE_ORDER: string[] = providers
  .listSources()
  .filter((s) => !DEPRIORITIZED.has(s.id))
  .sort((a, b) => b.rank - a.rank)
  .map((s) => s.id)

// Construye el objeto ScrapeMedia que la librería necesita (título + año + tmdbIds).
async function buildMedia(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<ScrapeMedia | null> {
  try {
    if (type === 'movie') {
      const d = await tmdbService.movieDetails(tmdbId) as any
      const year = d.release_date ? Number(d.release_date.slice(0, 4)) : undefined
      if (!d.title) return null
      return {
        type: 'movie',
        title: d.title,
        releaseYear: year ?? 0,
        tmdbId: String(tmdbId),
      }
    }

    // TV: necesitamos los tmdbId de temporada y episodio
    const d = await tmdbService.tvDetails(tmdbId) as any
    const seasonData = await tmdbService.tvSeason(tmdbId, season ?? 1) as any
    const ep = (seasonData.episodes ?? []).find(
      (e: any) => e.episode_number === (episode ?? 1)
    )
    if (!d.name || !ep) return null
    const year = d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : undefined
    return {
      type: 'show',
      title: d.name,
      releaseYear: year ?? 0,
      tmdbId: String(tmdbId),
      season: { number: season ?? 1, tmdbId: String(seasonData.id) },
      episode: { number: episode ?? 1, tmdbId: String(ep.id) },
    }
  } catch (e) {
    console.error('[resolve] buildMedia error:', (e as Error).message)
    return null
  }
}

// Convierte el RunOutput de la librería al StreamResult de nuestro API.
function toStreamResult(output: RunOutput): StreamResult | null {
  const { stream, sourceId } = output
  const headers = { ...(stream.headers ?? {}), ...(stream.preferredHeaders ?? {}) }
  const captions: Caption[] = (stream.captions ?? []).map((c) => ({
    language: c.language,
    url: c.url,
    type: c.type,
  }))

  if (stream.type === 'hls') {
    return { url: stream.playlist, type: 'hls', captions, headers, source: sourceId }
  }

  // file-based (mp4): elegir la mejor calidad disponible
  const order = ['4k', '1080', '720', '480', '360', 'unknown'] as const
  for (const q of order) {
    const file = stream.qualities[q]
    if (file?.url) {
      return { url: file.url, type: 'file', captions, headers, source: sourceId }
    }
  }
  return null
}

// Las fuentes casi no traen subtítulos → los buscamos en Wyzie Subs (gratis,
// por TMDB id). Key gratuita en https://store.wyzie.io/redeem → WYZIE_API_KEY.
const WYZIE_KEY = process.env.WYZIE_API_KEY

async function fetchSubtitles(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<Caption[]> {
  if (!WYZIE_KEY) return []
  try {
    const u = new URL('https://sub.wyzie.io/search')
    u.searchParams.set('id', String(tmdbId))
    u.searchParams.set('language', 'es,en')
    u.searchParams.set('format', 'srt')
    u.searchParams.set('key', WYZIE_KEY)
    if (type === 'tv') {
      u.searchParams.set('season', String(season ?? 1))
      u.searchParams.set('episode', String(episode ?? 1))
    }
    const arr = await fetch(u.toString(), { signal: AbortSignal.timeout(6000) }).then((r) => r.json())
    if (!Array.isArray(arr)) return []
    // Un subtítulo por idioma (el primero, que Wyzie ordena por relevancia)
    const seen = new Set<string>()
    const out: Caption[] = []
    for (const s of arr) {
      const lang = (s?.language ?? '').toLowerCase()
      if (!s?.url || !lang || seen.has(lang)) continue
      seen.add(lang)
      out.push({ language: s.display || s.language, url: s.url, type: s.format === 'vtt' ? 'vtt' : 'srt' })
    }
    console.error(`[subs] wyzie: ${out.map((c) => c.language).join(', ') || 'ninguno'}`)
    return out
  } catch (e) {
    console.error(`[subs] wyzie error: ${(e as Error).message}`)
    return []
  }
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const media = await buildMedia(type, tmdbId, season, episode)
  if (!media) {
    console.error(`[resolve] no se pudo construir media para ${type}/${tmdbId}`)
    return null
  }

  console.error(`[resolve] scraping "${media.title}" (${media.releaseYear})`)
  const t0 = Date.now()
  try {
    // Stream + subtítulos en paralelo (los subs no dependen del scrape)
    const [output, wyzieSubs] = await Promise.all([
      providers.runAll({ media, sourceOrder: SOURCE_ORDER }),
      fetchSubtitles(type, tmdbId, season, episode),
    ])
    if (!output) {
      console.error(`[resolve] sin stream para "${media.title}" (${Date.now() - t0}ms)`)
      return null
    }
    const result = toStreamResult(output)
    if (result) {
      // Wyzie (es/en) primero, luego lo que haya traído la fuente
      result.captions = [...wyzieSubs, ...result.captions]
    }
    console.error(
      `[resolve] OK via ${output.sourceId} (${result?.type}, ${result?.captions.length ?? 0} subs) en ${Date.now() - t0}ms`
    )
    return result
  } catch (e) {
    console.error(`[resolve] runAll error: ${(e as Error).message}`)
    return null
  }
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

// Diagnóstico detallado: corre runAll capturando el resultado de CADA source.
// Sirve para saber si los sources fallan por bloqueo de IP, CORS, o están muertos.
export async function debugScrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<any> {
  const media = await buildMedia(type, tmdbId, season, episode)
  if (!media) return { error: 'buildMedia falló (¿TMDB_API_KEY?)', media: null }

  const events: any[] = []
  let sourceIds: string[] = []
  let found: any = null
  const t0 = Date.now()
  try {
    const output = await providers.runAll({
      media,
      sourceOrder: SOURCE_ORDER,
      events: {
        init: (e) => { sourceIds = e.sourceIds },
        start: (id) => events.push({ id, phase: 'start' }),
        update: (e) => events.push({ id: e.id, status: e.status, reason: e.reason, error: e.error ? String((e.error as any)?.message ?? e.error).slice(0, 200) : undefined }),
      },
    })
    if (output) found = {
      sourceId: output.sourceId,
      streamType: output.stream.type,
      url: (output.stream.type === 'hls' ? output.stream.playlist : Object.values(output.stream.qualities)[0]?.url ?? '').slice(0, 120),
    }
  } catch (e) {
    return { error: String((e as Error).message), media, sourceIds, events }
  }
  return {
    ok: !!found,
    ms: Date.now() - t0,
    media,
    proxy: PROXY_URL ? 'configured' : 'none',
    totalSources: sourceIds.length,
    sourceIds,
    found,
    events,
  }
}

// Diagnóstico: prueba el resolver con Fight Club (TMDB 550)
export async function checkProviders(): Promise<ProviderHealth[]> {
  const TEST_ID = 550
  const start = Date.now()
  let ok = false
  try {
    ok = !!(await scrape('movie', TEST_ID))
  } catch {
    ok = false
  }
  return [{ name: 'movie-web', tier: 1, ok, ms: Date.now() - start }]
}
