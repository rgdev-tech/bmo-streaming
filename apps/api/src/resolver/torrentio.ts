// Torrentio (agregador de torrents, indexa por IMDb) + Real-Debrid (convierte el
// torrent en un link HTTP directo, cacheado — arranca al instante si ya está en
// su librería, que es la inmensa mayoría de contenido popular).
//
// Torrentio está detrás de un challenge de Cloudflare que bloquea CUALQUIER
// fetch de servidor "no-browser" — confirmado que las IPs de Vercel SÍ lo pasan
// (probado en producción), pero por las dudas mantenemos el mismo patrón
// directo→proxy que usa el resto del resolver.
//
// Este archivo es SOLO red y orquestación. Todo el criterio de selección (qué
// se puede reproducir, qué es mejor, qué se descarta) vive en torrentio.parse.ts,
// que es puro y está cubierto por tests.
import { tmdbService } from '../tmdb/tmdb.service'
import { TTLCache } from './cache'
import {
  rankCandidates, selectRunnable,
  type MediaRef, type ScoredCandidate, type TorrentioStream,
} from './torrentio.parse'

const PROXY_URL = process.env.STREAM_PROXY_URL
const DEBRID_KEY = process.env.DEBRID_KEY

const TORRENTIO_BASE = 'https://torrentio.strem.fun'
const FETCH_TIMEOUT = 12_000

export type { TorrentioStream, MediaRef } from './torrentio.parse'

async function safeFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    if (r.ok) return r
  } catch {}
  if (!PROXY_URL) return null
  try {
    const proxied = `${PROXY_URL}?destination=${encodeURIComponent(url)}`
    const r = await fetch(proxied, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    return r.ok ? r : null
  } catch {
    return null
  }
}

// El imdb id de un título es INMUTABLE, pero tmdbService.externalIds no cachea y
// imdbIdOf se llama en cada resolve de cache-miss (a veces más de una vez por
// flujo). Un caché de 24h + dedup de promesas quita ese round-trip a TMDB del
// camino crítico del arranque. Los null (título sin imdb) no se cachean (TTLCache
// no persiste nulls), así que se reintentan.
const imdbCache = new TTLCache<string | null>(24 * 60 * 60_000)

// Torrentio indexa por IMDb id, no por TMDB id.
export async function imdbIdOf(type: 'movie' | 'tv', tmdbId: number): Promise<string | null> {
  return imdbCache.resolve(`${type}:${tmdbId}`, async () => {
    try {
      const d = (await tmdbService.externalIds(type, tmdbId)) as { imdb_id?: string }
      return d?.imdb_id ?? null
    } catch {
      return null
    }
  })
}

function buildStreamUrl(imdbId: string, type: 'movie' | 'tv', season?: number, episode?: number): string {
  // El key de debrid va embebido en el path (config estándar de addons Stremio) —
  // así Torrentio devuelve streams con `url` ya resuelto vía Real-Debrid.
  const config = DEBRID_KEY ? `realdebrid=${DEBRID_KEY}/` : ''
  const kind = type === 'tv' ? 'series' : 'movie'
  const id = type === 'tv' ? `${imdbId}:${season ?? 1}:${episode ?? 1}` : imdbId
  return `${TORRENTIO_BASE}/${config}stream/${kind}/${id}.json`
}

// Cachea la respuesta cruda de Torrentio. Dos motivos:
//  - El selector de calidad hace dos llamadas (listar y luego elegir) y sin
//    esto Torrentio se consultaría dos veces.
//  - Sobre todo: mantiene ESTABLES los índices de la lista. El cliente elige
//    "la opción 3"; si entre listar y elegir cambiara el orden, reproduciría
//    otra cosa distinta de la que tocó.
const streamsCache = new TTLCache<TorrentioStream[]>(10 * 60_000)

function fetchStreamsCached(
  imdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<TorrentioStream[]> {
  const key = type === 'tv' ? `${imdbId}:${season}:${episode}` : imdbId
  return streamsCache.resolve(key, () => fetchStreams(imdbId, type, season, episode))
}

async function fetchStreams(
  imdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<TorrentioStream[]> {
  const url = buildStreamUrl(imdbId, type, season, episode)
  const r = await safeFetch(url)
  if (!r) return []
  try {
    const data = (await r.json()) as { streams?: TorrentioStream[] }
    return data.streams ?? []
  } catch {
    return []
  }
}

// El `url` que trae cada stream es el endpoint de RESOLUCIÓN de Torrentio (no
// el link final) — visitarlo hace que Torrentio arme el link en Real-Debrid y
// redirija a él. La cadena puede tener MÁS DE UN salto (Torrentio → arma el
// link en RD → RD redirige a su CDN) — seguir solo el primer Location dejaba
// una URL intermedia (no reproducible → CoreMediaErrorDomain -12646). Seguimos
// la cadena completa nosotros mismos, sin descargar el archivo.
const RESOLVE_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 6

// Cuando el archivo resuelto no es reproducible (p.ej. el torrent resultó ser
// un .rar, no un video) Torrentio NO da un error HTTP — redirige a un video
// placeholder en SU PROPIO dominio ("failed_rar_v2.mp4" y similares). Ese
// archivo existe y responde 200, así que sin este chequeo lo tratábamos como
// éxito y se lo pasábamos al player (que fallaba con -12646 al no ser el
// contenido real). El video final SIEMPRE vive en la CDN de Real-Debrid, nunca
// de vuelta en torrentio.strem.fun — cualquier resultado en ese dominio es
// un placeholder de error, se descarta.
function isTorrentioErrorPlaceholder(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('torrentio.strem.fun')
  } catch {
    return false
  }
}

async function followResolveUrl(startUrl: string): Promise<string | null> {
  let url = startUrl
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) })
      const loc = r.headers.get('location')
      // Cancelar el body en CADA salto. Solo nos interesan los headers, pero en
      // el salto final la respuesta es el video entero: sin este cancel, cada
      // candidato deja una descarga de varios GB corriendo dentro de la función
      // serverless hasta que expira el AbortSignal.
      await r.body?.cancel().catch(() => {})
      if (!loc) {
        // Sin más redirects: si la respuesta fue exitosa, esta ES la URL final.
        if (r.status < 200 || r.status >= 400) return null
        return isTorrentioErrorPlaceholder(url) ? null : url
      }
      url = new URL(loc, url).toString()
      if (isTorrentioErrorPlaceholder(url)) return null
    }
    return isTorrentioErrorPlaceholder(url) ? null : url
  } catch {
    return null
  }
}

export const debridEnabled = !!DEBRID_KEY

export type DebridResult = { url: string; label: string; language: string; hasLatinoAlternative: boolean }

export type DebridRequest = {
  type: 'movie' | 'tv'
  tmdbId: number
  lang: 'original' | 'latino'
  media: MediaRef
  season?: number
  episode?: number
}

// Carrera por olas en vez de lanzar todos los candidatos de una.
//
// `Promise.any` sobre la lista entera ignora el ranking: gana el más rápido,
// que puede ser el peor. Con olas, los mejores arrancan primero y tienen una
// ventana para ganar; si ninguno responde a tiempo (o todos fallan), se suma
// la siguiente tanda. Así el orden importa sin renunciar al paralelismo.
//
// `attempt` se inyecta para poder testear la mecánica sin tocar la red.
export type Wave = { count: number; waitMs: number }
const WAVES: Wave[] = [
  { count: 2, waitMs: 4000 },
  { count: 5, waitMs: 6000 },
]

export async function raceInWaves<C, R>(
  candidates: C[],
  waves: Wave[],
  attempt: (c: C) => Promise<R>
): Promise<R | null> {
  // Las promesas se crean UNA sola vez por candidato y se reusan entre olas —
  // volver a llamar a `attempt` dispararía un segundo resolve del mismo torrent.
  const started = new Map<number, Promise<R>>()
  const startUpTo = (n: number) => {
    for (let i = 0; i < Math.min(n, candidates.length); i++) {
      if (!started.has(i)) started.set(i, attempt(candidates[i]))
    }
    return [...started.values()]
  }

  for (let w = 0; w < waves.length; w++) {
    const pool = startUpTo(waves[w].count)
    if (!pool.length) return null
    const isLast = w === waves.length - 1 || waves[w].count >= candidates.length

    // Las promesas rechazadas se "absorben" para que Promise.any no explote y
    // para no dejar unhandled rejections cuando avanzamos de ola.
    const anyOk = Promise.any(pool).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const }))
    const settled = isLast
      ? await anyOk
      : await Promise.race([
          anyOk,
          new Promise<{ ok: false }>((res) => setTimeout(() => res({ ok: false }), waves[w].waitMs)),
        ])
    if (settled.ok) return settled.r
    if (isLast) return null
  }
  return null
}

async function tryCandidate(c: ScoredCandidate): Promise<{ url: string; c: ScoredCandidate }> {
  const finalUrl = await followResolveUrl(c.parsed.resolveUrl!)
  if (!finalUrl) throw new Error(`no resolvió: ${c.parsed.filename}`)
  return { url: finalUrl, c }
}

// Una fuente ofrecida al usuario en el selector de calidad. Deliberadamente NO
// incluye la URL de resolución: esa lleva la clave de Real-Debrid embebida en
// el path y no puede salir del servidor. El cliente elige por índice.
export type SourceOption = {
  i: number
  label: string
  resolution: number | null
  codec: string | null
  hdr: string
  sizeGB: number | null
  cached: boolean | null
  langs: string[]
}

// Lista de fuentes ejecutables, en el mismo orden que usa el resolver — el
// índice de esta lista es el que después acepta resolveDebridStream({ pick }).
export async function listDebridSources(req: DebridRequest): Promise<SourceOption[]> {
  const runnable = await rankRunnable(req)
  return runnable.map((c, i) => ({
    i,
    label: c.parsed.filename,
    resolution: c.parsed.resolution,
    codec: c.parsed.codec,
    hdr: c.parsed.hdr,
    sizeGB: c.parsed.sizeGB,
    cached: c.parsed.cached,
    langs: [...c.parsed.langs],
  }))
}

// Paso común de listar y resolver: pedir a Torrentio, rankear y filtrar.
async function rankRunnable(req: DebridRequest): Promise<ScoredCandidate[]> {
  if (!DEBRID_KEY) return []
  const imdbId = await imdbIdOf(req.type, req.tmdbId)
  if (!imdbId) return []
  const streams = await fetchStreamsCached(imdbId, req.type, req.season, req.episode)
  return selectRunnable(rankCandidates(streams, req.media, req.lang))
}

export async function resolveDebridStream(
  req: DebridRequest,
  // Índice dentro de listDebridSources(). Cuando viene, se resuelve ESA fuente
  // en vez de correr la carrera — es el selector de calidad del reproductor.
  pick?: number
): Promise<DebridResult | null> {
  if (!DEBRID_KEY) return null

  const t0 = Date.now()
  const imdbId = await imdbIdOf(req.type, req.tmdbId)
  if (!imdbId) return null

  const streams = await fetchStreamsCached(imdbId, req.type, req.season, req.episode)
  const tFetch = Date.now() - t0
  const r = rankCandidates(streams, req.media, req.lang)

  if (r.cacheSignal === 'absent' && streams.length > 0) {
    // Torrentio cambió el formato del marcador de cacheado: seguimos andando
    // (sin filtrar) pero hay que arreglar parseCacheState. El endpoint
    // /resolve/debug/debrid/... devuelve los `rawName` para poder ajustarlo.
    console.error('[debrid] ⚠️ marcador de cacheado ilegible — revisar parseCacheState()')
  }

  const runnable = selectRunnable(r)
  if (!runnable.length) {
    console.error(
      `[debrid] torrentio: ${streams.length} streams (${tFetch}ms) — 0 ejecutables ` +
      `(cache ${r.cacheCounts.cached}/${r.cacheCounts.uncached}/${r.cacheCounts.unknown} señal=${r.cacheSignal}, ` +
      `${r.rejected.length} rechazados)`
    )
    return null
  }

  // Elección explícita del usuario: se resuelve solo esa, sin carrera. Si falla
  // se devuelve null en vez de caer a otra — el usuario pidió ESA calidad y
  // darle otra en silencio sería peor que avisarle.
  if (pick != null) {
    const chosen = runnable[pick]
    if (!chosen) return null
    try {
      const out = await tryCandidate(chosen)
      const cp = out.c.parsed
      console.error(`[debrid] fuente elegida #${pick} → ${cp.filename}`)
      return {
        url: out.url,
        label: cp.filename,
        language: cp.langs.has('latino') ? 'Español Latino' : 'Original',
        hasLatinoAlternative: r.hasLatinoAlternative,
      }
    } catch {
      console.error(`[debrid] la fuente elegida #${pick} no resolvió`)
      return null
    }
  }

  const tRace = Date.now()
  const winner = await raceInWaves(runnable, WAVES, tryCandidate)
  if (!winner) {
    console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRace}ms — ninguno de ${runnable.length} resolvió`)
    return null
  }

  const p = winner.c.parsed
  console.error(
    `[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRace}ms ` +
    `(${runnable.length} ejecutables de ${streams.length}) → ${p.filename} ` +
    `[score ${Math.round(winner.c.score)} · ${p.resolution ?? '?'}p ${p.codec ?? '?'} · cached=${p.cached}]`
  )
  return {
    url: winner.url,
    label: p.filename,
    language: p.langs.has('latino') ? 'Español Latino' : 'Original',
    hasLatinoAlternative: r.hasLatinoAlternative,
  }
}

// Diagnóstico: lista los candidatos rankeados sin resolver el link final (rápido).
//
// Es el ÚNICO canal para verificar el formato del marcador de cacheado, porque
// Torrentio solo responde a IPs de Vercel: no se puede comprobar en local ni en
// los tests. Por eso devuelve los `rawName`/`rawTitle` crudos además del
// veredicto — si `cacheSignal` no es 'ok', con esta misma respuesta se ajusta
// parseCacheState() sin tener que adivinar.
export async function debugTorrentio(
  type: 'movie' | 'tv',
  tmdbId: number,
  media: MediaRef,
  season?: number,
  episode?: number
): Promise<any> {
  const imdbId = await imdbIdOf(type, tmdbId)
  if (!imdbId) return { error: 'no se pudo obtener imdb_id', debridEnabled }

  const streams = await fetchStreams(imdbId, type, season, episode)
  const r = rankCandidates(streams, media, 'original')
  const runnable = selectRunnable(r)

  return {
    imdbId,
    debridEnabled,
    media,
    totalStreams: streams.length,
    // Cuenta los que realmente pueden competir (con `url` y sin rechazo), no
    // una aproximación distinta a la del ranking real.
    candidates: r.ranked.length,
    runnable: runnable.length,
    cacheSignal: r.cacheSignal,
    cacheCounts: r.cacheCounts,
    hasLatinoAlternative: r.hasLatinoAlternative,
    // Crudos: para verificar/ajustar parseCacheState y la detección de idioma.
    rawSamples: streams.slice(0, 5).map((s) => ({
      name: s.name,
      title: s.title?.slice(0, 160),
      filename: s.behaviorHints?.filename,
    })),
    top: r.ranked.slice(0, 8).map((c) => ({
      label: c.parsed.filename.slice(0, 90),
      score: Math.round(c.score),
      cached: c.parsed.cached,
      resolution: c.parsed.resolution,
      codec: c.parsed.codec,
      hdr: c.parsed.hdr,
      sizeGB: c.parsed.sizeGB,
      langs: [...c.parsed.langs],
      parts: Object.fromEntries(Object.entries(c.parts).map(([k, v]) => [k, Math.round(v)])),
    })),
    rejected: r.rejected.slice(0, 15),
  }
}
