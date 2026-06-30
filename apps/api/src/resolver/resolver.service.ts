import {
  makeProviders,
  makeStandardFetcher,
  makeSimpleProxyFetcher,
  targets,
  type ScrapeMedia,
  type RunOutput,
} from '@movie-web/providers'
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

// Cliente de @movie-web/providers — scraping por HTTP puro (sin navegador).
// target NATIVE: devuelve URLs de stream directas, ideal para apps nativas.
const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  proxiedFetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, fetch) : undefined,
  target: targets.NATIVE,
  consistentIpForRequests: true,
})

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
    const output = await providers.runAll({ media })
    if (!output) {
      console.error(`[resolve] sin stream para "${media.title}" (${Date.now() - t0}ms)`)
      return null
    }
    const result = toStreamResult(output)
    console.error(
      `[resolve] OK via ${output.sourceId} (${result?.type}) en ${Date.now() - t0}ms`
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
