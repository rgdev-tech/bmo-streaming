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
import { resolveRelativeUrls } from './hls'
import { resolveDebridStream, debridEnabled, debugTorrentio } from './torrentio'

const STREAM_TTL = 30 * 60 * 1000  // 30 min — los tokens del CDN suelen expirar antes de 90 min

// Proxy opcional (Cloudflare Worker en apps/proxy). Si STREAM_PROXY_URL está
// definido, los scrapers que requieren CORS/headers especiales pasan por él.
const PROXY_URL = process.env.STREAM_PROXY_URL

const CACHE_FILE = process.env.VERCEL
  ? '/tmp/bmo-streams.json'
  : '.cache/streams.json'
const cache = new TTLCache<StreamResult | null>(STREAM_TTL, CACHE_FILE)

// altUrls: candidatos de respaldo para el mismo idioma (mismo uso que el
// fallback de fuentes de video) — algunos hosts de subtítulos (dl.opensubtitles.org)
// bloquean fetches de servidor con un challenge de Cloudflare que ni Vercel ni
// nuestro proxy pueden resolver; si el primero falla, /sub.vtt prueba el resto.
export type Caption = { language: string; url: string; type: string; altUrls?: string[] }

export type AudioLang = 'original' | 'latino'

export type StreamResult = {
  url: string                          // m3u8 (hls) o mp4 (file) — URL directa del CDN
  type: 'hls' | 'file'
  captions: Caption[]
  headers: Record<string, string>      // headers que el CDN espera (Referer/Origin/etc.)
  source: string
  language: string                     // etiqueta de idioma de audio inferida ("Español Latino" / "Original")
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

// Fuentes excluidas del scrape:
//  - vidlink: mp4 H.265 (hev1) → iOS/AVPlayer reproduce audio pero NO video.
//  - vidrock: SEÑUELO. Devuelve un HLS válido (storrrrrrm.site) cuyos "segmentos"
//    son imágenes PNG de tiktokcdn, no video → nunca reproduce. Además su master
//    no trae BANDWIDTH. Confirmado en 278/155/27205.
const DEPRIORITIZED = new Set(['vidlink', 'vidrock'])

// Fuentes con audio en español (Latino/castellano). Usadas para el doblaje Latino.
const LATINO_SOURCES = ['cuevana3', 'pelisplushd', 'cinehdplus']

// Orden base: todas por rank desc, las deprioritizadas al final.
const BASE_ORDER: string[] = providers
  .listSources()
  .filter((s) => !DEPRIORITIZED.has(s.id))
  .sort((a, b) => b.rank - a.rank)
  .map((s) => s.id)

// Orden de fuentes según el idioma de audio preferido.
// exclude: fuentes que el cliente ya intentó y fallaron al reproducir → se saltan.
function buildSourceOrder(lang: AudioLang, exclude: string[] = []): string[] {
  const ex = new Set(exclude)
  const base = BASE_ORDER.filter((id) => !ex.has(id))
  if (lang !== 'latino') return base
  const latino = LATINO_SOURCES.filter((id) => base.includes(id))
  const rest = base.filter((id) => !latino.includes(id))
  return [...latino, ...rest]
}

// Etiqueta de idioma de audio inferida a partir de la fuente ganadora.
function languageLabel(sourceId: string): string {
  return LATINO_SOURCES.includes(sourceId) ? 'Español Latino' : 'Original'
}

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
      season: {
        number: season ?? 1,
        tmdbId: String(seasonData.id),
        title: seasonData.name ?? `Season ${season ?? 1}`,
        episodeCount: (seasonData.episodes ?? []).length || undefined,
      },
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

  const language = languageLabel(sourceId)

  if (stream.type === 'hls') {
    return { url: stream.playlist, type: 'hls', captions, headers, source: sourceId, language }
  }

  // file-based (mp4): elegir la mejor calidad disponible
  const order = ['4k', '1080', '720', '480', '360', 'unknown'] as const
  for (const q of order) {
    const file = stream.qualities[q]
    if (file?.url) {
      return { url: file.url, type: 'file', captions, headers, source: sourceId, language }
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
    u.searchParams.set('language', 'es,en,pt')
    u.searchParams.set('format', 'srt')
    u.searchParams.set('key', WYZIE_KEY)
    if (type === 'tv') {
      u.searchParams.set('season', String(season ?? 1))
      u.searchParams.set('episode', String(episode ?? 1))
    }
    const arr = await fetch(u.toString(), { signal: AbortSignal.timeout(6000) }).then((r) => r.json())
    if (!Array.isArray(arr)) return []
    // Hasta 3 candidatos por idioma (Wyzie ordena por relevancia) — el primero
    // es el preferido, el resto queda como respaldo si ese host está bloqueado.
    const byLang = new Map<string, { display: string; type: string; urls: string[] }>()
    for (const s of arr) {
      const lang = (s?.language ?? '').toLowerCase()
      if (!s?.url || !lang) continue
      const entry = byLang.get(lang)
      if (!entry) {
        byLang.set(lang, { display: s.display || s.language, type: s.format === 'vtt' ? 'vtt' : 'srt', urls: [s.url] })
      } else if (entry.urls.length < 3) {
        entry.urls.push(s.url)
      }
    }
    const out: Caption[] = [...byLang.values()].map((e) => ({
      language: e.display, type: e.type, url: e.urls[0], altUrls: e.urls.slice(1),
    }))
    console.error(`[subs] wyzie: ${out.map((c) => `${c.language}(${1 + (c.altUrls?.length ?? 0)})`).join(', ') || 'ninguno'}`)
    return out
  } catch (e) {
    console.error(`[subs] wyzie error: ${(e as Error).message}`)
    return []
  }
}

// ── Detección de señuelos ───────────────────────────────────────────────────
// Algunas fuentes devuelven un HLS/mp4 estructuralmente válido cuyos "segmentos"
// son en realidad imágenes (PNG/JPEG) u otra basura → el player falla siempre.
// Validamos el primer segmento real antes de aceptar un stream.

// Lee el primer chunk de un segmento (sin Range — algunos CDNs lo rechazan con
// un JSON de error). Abre el stream, lee el primer trozo y cancela. Directo y,
// si falla, vía CF Worker.
async function fetchHead(
  url: string,
  referer: string
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const tryFetch = async (u: string, h: Record<string, string>) => {
    try {
      const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(6000) })
      if (!r.ok) return null
      const ct = r.headers.get('content-type') ?? ''
      const reader = r.body?.getReader()
      if (!reader) {
        const buf = new Uint8Array((await r.arrayBuffer()).slice(0, 64))
        return { contentType: ct, bytes: buf }
      }
      const { value } = await reader.read()
      reader.cancel().catch(() => {})
      return { contentType: ct, bytes: (value ?? new Uint8Array()).slice(0, 64) }
    } catch { return null }
  }
  const direct = await tryFetch(url, referer ? { Referer: referer } : {})
  if (direct) return direct
  if (!PROXY_URL) return null
  const proxyH: Record<string, string> = referer ? { 'x-referer': referer } : {}
  return tryFetch(`${PROXY_URL}?destination=${encodeURIComponent(url)}`, proxyH)
}

// Descarga texto (playlist) directo o vía proxy.
async function fetchText(url: string, referer: string): Promise<string | null> {
  const tryFetch = async (u: string, h: Record<string, string>) => {
    try {
      const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(6000) })
      return r.ok ? await r.text() : null
    } catch { return null }
  }
  const direct = await tryFetch(url, referer ? { Referer: referer } : {})
  if (direct) return direct
  if (!PROXY_URL) return null
  const proxyH: Record<string, string> = referer ? { 'x-referer': referer } : {}
  return tryFetch(`${PROXY_URL}?destination=${encodeURIComponent(url)}`, proxyH)
}

function firstUri(playlist: string): string | null {
  for (const line of playlist.split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#')) return t
  }
  return null
}

// Resuelve master → variante → URL del primer segmento real.
async function firstSegmentUrl(playlistUrl: string, referer: string): Promise<string | null> {
  const master = await fetchText(playlistUrl, referer)
  if (!master) return null
  let mediaUrl = playlistUrl
  let media = resolveRelativeUrls(master, playlistUrl)
  if (media.includes('#EXT-X-STREAM-INF')) {
    const variant = firstUri(media)
    if (!variant) return null
    const v = await fetchText(variant, referer)
    if (!v) return null
    mediaUrl = variant
    media = resolveRelativeUrls(v, variant)
  }
  return firstUri(media)
}

// ¿Los bytes/content-type corresponden a una imagen (señuelo) en vez de video?
function looksLikeImage(contentType: string, b: Uint8Array): boolean {
  if (contentType.startsWith('image/')) return true
  if (b.length < 4) return false
  const [a, c, d, e] = b
  if (a === 0x89 && c === 0x50 && d === 0x4e && e === 0x47) return true        // PNG
  if (a === 0xff && c === 0xd8 && d === 0xff) return true                       // JPEG
  if (a === 0x47 && c === 0x49 && d === 0x46 && e === 0x38) return true         // GIF8
  if (a === 0x42 && c === 0x4d) return true                                     // BMP
  if (a === 0x52 && c === 0x49 && d === 0x46 && e === 0x46                       // RIFF (WEBP)
    && b.length >= 12 && b[8] === 0x57 && b[9] === 0x45) return true
  return false
}

const DECOY_BUDGET_MS = 5_000

// True solo ante evidencia POSITIVA de señuelo. Si no se puede verificar
// (bloqueo de IP, timeout), devuelve false → no rechazamos por dudas de red.
// Acotado a DECOY_BUDGET_MS para no penalizar la velocidad del happy path.
async function isDecoy(result: StreamResult): Promise<boolean> {
  const check = async (): Promise<boolean> => {
    const referer = result.headers.Referer ?? result.headers.referer ?? ''
    const segUrl = result.type === 'hls'
      ? await firstSegmentUrl(result.url, referer)
      : result.url
    if (!segUrl) return false
    const head = await fetchHead(segUrl, referer)
    if (!head) return false
    return looksLikeImage(head.contentType, head.bytes)
  }
  const budget = new Promise<boolean>((res) => setTimeout(() => res(false), DECOY_BUDGET_MS))
  return Promise.race([check(), budget])
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  lang: AudioLang,
  season?: number,
  episode?: number,
  exclude: string[] = []
): Promise<StreamResult | null> {
  const media = await buildMedia(type, tmdbId, season, episode)
  if (!media) {
    console.error(`[resolve] no se pudo construir media para ${type}/${tmdbId}`)
    return null
  }

  console.error(`[resolve] scraping "${media.title}" (${media.releaseYear}) lang=${lang}${exclude.length ? ` excl=${exclude.join(',')}` : ''}`)
  const t0 = Date.now()
  try {
    // Subtítulos en paralelo (no dependen del scrape de video)
    const subsP = fetchSubtitles(type, tmdbId, season, episode)

    // Real-Debrid primero (si está configurado y el cliente no lo excluyó ya
    // por haber fallado al reproducir): cobertura y calidad muy superiores a
    // los scrapers HTTP. 'realdebrid' se trata como una fuente más para el
    // mecanismo de exclude del cliente.
    if (debridEnabled && !exclude.includes('realdebrid')) {
      try {
        const debrid = await resolveDebridStream(type, tmdbId, lang, season, episode)
        if (debrid) {
          const result: StreamResult = {
            url: debrid.url,
            type: 'file',
            captions: await subsP,
            headers: {},
            source: 'realdebrid',
            language: debrid.language,
          }
          console.error(`[resolve] OK via realdebrid (${debrid.label}) en ${Date.now() - t0}ms`)
          return result
        }
        console.error(`[resolve] realdebrid sin resultado (${Date.now() - t0}ms), cae a scrapers`)
      } catch (e) {
        console.error(`[resolve] realdebrid error: ${(e as Error).message}`)
      }
    }

    // Iteramos fuentes: si la ganadora resulta ser un señuelo (segmentos = imágenes),
    // la descartamos y seguimos con la siguiente. Acotado por TIEMPO (no por nº de
    // intentos): antes cortábamos a los 3 y dejábamos fuera fuentes buenas (p.ej.
    // cuevana3 quedaba tras 3 señuelos en lang=original → 404 falso).
    // Semilla: las fuentes que el cliente ya intentó y fallaron al REPRODUCIR (exclude).
    const SCRAPE_BUDGET_MS = 22_000  // margen bajo el límite de 30s de Vercel
    const deadline = t0 + SCRAPE_BUDGET_MS
    const blocked = new Set<string>(exclude)
    let result: StreamResult | null = null
    let winner = ''
    while (Date.now() < deadline) {
      const order = buildSourceOrder(lang).filter((id) => !blocked.has(id))
      if (!order.length) break

      const output = await providers.runAll({ media, sourceOrder: order })
      if (!output) break

      const candidate = toStreamResult(output)
      if (!candidate) { blocked.add(output.sourceId); continue }

      if (await isDecoy(candidate)) {
        console.error(`[resolve] señuelo descartado: ${output.sourceId}`)
        blocked.add(output.sourceId)
        continue
      }
      result = candidate
      winner = output.sourceId
      break
    }

    if (!result) {
      console.error(`[resolve] sin stream válido para "${media.title}" (${Date.now() - t0}ms)`)
      return null
    }

    // Wyzie (es/en/pt) primero, luego lo que haya traído la fuente
    result.captions = [...(await subsP), ...result.captions]
    console.error(
      `[resolve] OK via ${winner} (${result.type}, ${result.language}, ${result.captions.length} subs) en ${Date.now() - t0}ms`
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
  episode?: number,
  lang: AudioLang = 'original',
  exclude: string[] = []
): Promise<StreamResult | null> {
  const base = type === 'tv' ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`
  const ex = [...exclude].sort().join(',')
  const key = ex ? `${base}:${lang}:x=${ex}` : `${base}:${lang}`
  return cache.resolve(key, () => scrape(type, tmdbId, lang, season, episode, exclude))
}

// Diagnóstico de subtítulos: hace el fetch crudo a Wyzie y reporta qué pasó.
export async function debugSubs(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<any> {
  if (!WYZIE_KEY) return { error: 'WYZIE_API_KEY no está definida en el entorno' }
  const u = new URL('https://sub.wyzie.io/search')
  u.searchParams.set('id', String(tmdbId))
  u.searchParams.set('language', 'es,en,pt')
  u.searchParams.set('format', 'srt')
  u.searchParams.set('key', WYZIE_KEY)
  if (type === 'tv') {
    u.searchParams.set('season', String(season ?? 1))
    u.searchParams.set('episode', String(episode ?? 1))
  }
  const safeUrl = u.toString().replace(WYZIE_KEY, '***')
  try {
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) })
    const body = await r.text()
    let parsed: any = null
    try { parsed = JSON.parse(body) } catch {}
    return {
      url: safeUrl,
      status: r.status,
      ok: r.ok,
      isArray: Array.isArray(parsed),
      count: Array.isArray(parsed) ? parsed.length : undefined,
      sample: Array.isArray(parsed) ? parsed.slice(0, 3) : undefined,
      bodyPreview: parsed ? undefined : body.slice(0, 300),
    }
  } catch (e) {
    return { url: safeUrl, error: String((e as Error).message) }
  }
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
      sourceOrder: BASE_ORDER,
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
    ok = !!(await scrape('movie', TEST_ID, 'original'))
  } catch {
    ok = false
  }
  return [{ name: 'movie-web', tier: 1, ok, ms: Date.now() - start }]
}
