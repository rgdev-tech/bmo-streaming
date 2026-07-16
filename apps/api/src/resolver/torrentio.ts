// Torrentio (agregador de torrents, indexa por IMDb) + Real-Debrid (convierte el
// torrent en un link HTTP directo, cacheado — arranca al instante si ya está en
// su librería, que es la inmensa mayoría de contenido popular).
//
// Torrentio está detrás de un challenge de Cloudflare que bloquea CUALQUIER
// fetch de servidor "no-browser" — confirmado que las IPs de Vercel SÍ lo pasan
// (probado en producción), pero por las dudas mantenemos el mismo patrón
// directo→proxy que usa el resto del resolver.
import { tmdbService } from '../tmdb/tmdb.service'

const PROXY_URL = process.env.STREAM_PROXY_URL
const DEBRID_KEY = process.env.DEBRID_KEY

const TORRENTIO_BASE = 'https://torrentio.strem.fun'
const FETCH_TIMEOUT = 12_000

export type TorrentioStream = {
  name?: string
  title?: string
  infoHash?: string
  fileIdx?: number
  url?: string
  behaviorHints?: { filename?: string; bingeGroup?: string }
}

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

// Torrentio indexa por IMDb id, no por TMDB id.
export async function imdbIdOf(type: 'movie' | 'tv', tmdbId: number): Promise<string | null> {
  try {
    const d = (await tmdbService.externalIds(type, tmdbId)) as { imdb_id?: string }
    return d?.imdb_id ?? null
  } catch {
    return null
  }
}

function buildStreamUrl(imdbId: string, type: 'movie' | 'tv', season?: number, episode?: number): string {
  // El key de debrid va embebido en el path (config estándar de addons Stremio) —
  // así Torrentio devuelve streams con `url` ya resuelto vía Real-Debrid.
  const config = DEBRID_KEY ? `realdebrid=${DEBRID_KEY}/` : ''
  const kind = type === 'tv' ? 'series' : 'movie'
  const id = type === 'tv' ? `${imdbId}:${season ?? 1}:${episode ?? 1}` : imdbId
  return `${TORRENTIO_BASE}/${config}stream/${kind}/${id}.json`
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

function fileText(s: TorrentioStream): string {
  return `${s.title ?? ''} ${s.behaviorHints?.filename ?? ''}`
}

// mp4 reproduce nativo en iOS (AVPlayer) y mkv vía VLCKit (ver VideoVLCView.mm)
// — son los dos formatos que el player sabe reproducir directo, sin conversión.
function isDirectPlayFile(s: TorrentioStream): boolean {
  const name = (s.behaviorHints?.filename ?? '').toLowerCase()
  return name.endsWith('.mp4') || name.endsWith('.mkv')
}

// Prioriza resolución; penaliza archivos gigantes (riesgo de buffering en
// móvil) y REMUX (mismo motivo, sin ganancia real de calidad percibida).
function score(s: TorrentioStream): number {
  const text = fileText(s)
  let pts = 0
  if (/2160p|4k/i.test(text)) pts += 40
  else if (/1080p/i.test(text)) pts += 30
  else if (/720p/i.test(text)) pts += 20
  else pts += 5

  if (/hdr|dolby.?vision|\bdv\b/i.test(text)) pts += 5

  const sizeMatch = text.match(/💾\s*([\d.]+)\s*GB/i)
  const sizeGB = sizeMatch ? parseFloat(sizeMatch[1]) : null
  if (sizeGB != null) {
    if (sizeGB > 25) pts -= 20
    else if (sizeGB > 12) pts -= 6
  }
  if (/remux/i.test(text)) pts -= 10

  return pts
}

function hasLatinoAudio(s: TorrentioStream): boolean {
  return /latino|castellano/i.test(fileText(s))
}

type Candidate = { stream: TorrentioStream; resolveUrl: string; label: string; latino: boolean }

// Solo streams .mp4/.mkv ya resueltos por Torrentio (traen `url`), ordenados
// por idioma pedido y luego por calidad.
function rankCandidates(streams: TorrentioStream[], lang: 'original' | 'latino'): Candidate[] {
  const playable = streams.filter((s) => s.url && isDirectPlayFile(s))
  const ranked = playable
    .map((s) => ({
      stream: s,
      resolveUrl: s.url!,
      label: s.behaviorHints?.filename ?? s.title ?? 'stream',
      latino: hasLatinoAudio(s),
      sc: score(s),
    }))
    .sort((a, b) => {
      if (lang === 'latino' && a.latino !== b.latino) return a.latino ? -1 : 1
      return b.sc - a.sc
    })
  return ranked.map(({ stream, resolveUrl, label, latino }) => ({ stream, resolveUrl, label, latino }))
}

// El `url` que trae cada stream es el endpoint de RESOLUCIÓN de Torrentio (no
// el link final) — visitarlo hace que Torrentio arme el link en Real-Debrid y
// redirija a él. La cadena puede tener MÁS DE UN salto (Torrentio → arma el
// link en RD → RD redirige a su CDN) — seguir solo el primer Location dejaba
// una URL intermedia (no reproducible → CoreMediaErrorDomain -12646). Seguimos
// la cadena completa nosotros mismos, sin descargar el archivo.
// Timeout corto: si el torrent NO está cacheado en RD esto tarda mucho (o
// nunca resuelve) — mejor descartarlo rápido y que gane otro candidato ya
// cacheado (instantáneo).
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

// Más candidatos en la carrera = más chance de incluir uno ya cacheado en RD
// (Torrentio suele adelantar los cacheados en su propio orden; si nuestro
// re-ranking por calidad los empuja fuera del pool, perdemos esa ventaja).
// Promise.any no espera a todos — el costo extra es mínimo.
const MAX_TRIES = 6

// Si pedimos latino y hay candidatos latino, les damos esta ventana para
// resolver ANTES de sumar al resto a la carrera — Promise.any no respeta
// ranking, solo velocidad, así que sin esto un candidato peor pero ya
// cacheado le gana por rapidez al latino aunque sea justo lo que se pidió.
const LATINO_HEAD_START_MS = 3000

type RawResult = { url: string; label: string; latino: boolean }

async function tryCandidate(c: Candidate): Promise<RawResult> {
  const finalUrl = await followResolveUrl(c.resolveUrl)
  if (!finalUrl) throw new Error(`no resolvió: ${c.label}`)
  return { url: finalUrl, label: c.label, latino: c.latino }
}

export async function resolveDebridStream(
  type: 'movie' | 'tv',
  tmdbId: number,
  lang: 'original' | 'latino',
  season?: number,
  episode?: number
): Promise<DebridResult | null> {
  if (!DEBRID_KEY) return null

  const t0 = Date.now()
  const imdbId = await imdbIdOf(type, tmdbId)
  if (!imdbId) return null

  const streams = await fetchStreams(imdbId, type, season, episode)
  const tFetch = Date.now() - t0
  const candidates = rankCandidates(streams, lang)
  if (!candidates.length) {
    console.error(`[debrid] torrentio: ${streams.length} streams (${tFetch}ms) — 0 candidatos mp4/mkv`)
    return null
  }

  const top = candidates.slice(0, MAX_TRIES)
  const hasLatinoAlternative = candidates.some((c) => c.latino)
  const toResult = (r: RawResult): DebridResult => ({
    url: r.url, label: r.label, language: r.latino ? 'Español Latino' : 'Original', hasLatinoAlternative,
  })

  const tRaceStart = Date.now()
  const latinoGroup = lang === 'latino' ? top.filter((c) => c.latino) : []

  if (latinoGroup.length > 0) {
    const latinoPromises = latinoGroup.map(tryCandidate)
    const headStart = await Promise.race([
      Promise.any(latinoPromises).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), LATINO_HEAD_START_MS)),
    ])
    if (headStart.ok) {
      console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRaceStart}ms (latino con ventaja, ${latinoGroup.length} candidatos) → ${headStart.r.label}`)
      return toResult(headStart.r)
    }
    const others = top.filter((c) => !c.latino)
    try {
      const winner = await Promise.any([...latinoPromises, ...others.map(tryCandidate)])
      console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRaceStart}ms (sin latino a tiempo, fallback) → ${winner.label}`)
      return toResult(winner)
    } catch {
      console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRaceStart}ms — ninguno de ${top.length} candidatos resolvió`)
      return null
    }
  }

  // Carrera en paralelo entre los mejores candidatos — el que ya está
  // cacheado en Real-Debrid resuelve casi al instante, así no esperamos
  // secuencialmente a que cada uno agote su timeout antes de probar el siguiente.
  try {
    const winner = await Promise.any(top.map(tryCandidate))
    console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRaceStart}ms (${top.length} candidatos) → ${winner.label}`)
    return toResult(winner)
  } catch {
    console.error(`[debrid] torrentio ${tFetch}ms + carrera ${Date.now() - tRaceStart}ms — ninguno de ${top.length} candidatos resolvió`)
    return null // AggregateError: ninguno resolvió a tiempo
  }
}

// Diagnóstico: lista los candidatos rankeados sin resolver el link final (rápido).
export async function debugTorrentio(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<any> {
  const imdbId = await imdbIdOf(type, tmdbId)
  if (!imdbId) return { error: 'no se pudo obtener imdb_id', debridEnabled }

  const streams = await fetchStreams(imdbId, type, season, episode)
  const playable = streams.filter(isDirectPlayFile)
  const ranked = rankCandidates(streams, 'original')
  const latinoOnes = ranked.filter((c) => c.latino)
  // También buscamos "latino"/"castellano" en TODOS los streams crudos (no solo
  // los .mp4/.mkv playable) — para descartar que el propio filtro de formato
  // esté tapando releases con doblaje que vengan en otro contenedor.
  const rawLatinoMatches = streams.filter((s) =>
    /latino|castellano/i.test(`${s.title ?? ''} ${s.behaviorHints?.filename ?? ''}`)
  )
  return {
    imdbId,
    debridEnabled,
    totalStreams: streams.length,
    playableCount: playable.length,
    latinoCount: latinoOnes.length,
    latino: latinoOnes.slice(0, 5).map((c) => c.label),
    rawLatinoMatchesCount: rawLatinoMatches.length,
    rawLatinoMatches: rawLatinoMatches.slice(0, 5).map((s) => s.behaviorHints?.filename ?? s.title),
    top: ranked.slice(0, 8).map((c) => ({ label: c.label, latino: c.latino })),
  }
}
