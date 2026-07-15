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

// mp4 reproduce nativo en iOS (AVPlayer). mkv no tiene demuxer nativo — nunca
// reproduce, sin importar qué tan bien se resuelva el link.
function isMp4(s: TorrentioStream): boolean {
  return (s.behaviorHints?.filename ?? '').toLowerCase().endsWith('.mp4')
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

// Solo streams .mp4 ya resueltos por Torrentio (traen `url`), ordenados por
// idioma pedido y luego por calidad.
function rankCandidates(streams: TorrentioStream[], lang: 'original' | 'latino'): Candidate[] {
  const playable = streams.filter((s) => s.url && isMp4(s))
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
// redirija a él. Lo seguimos server-side (sin descargar el archivo) para
// obtener la URL directa real.
async function followResolveUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    const loc = r.headers.get('location')
    if (loc) return loc
  } catch {}
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    if (r.ok && r.url && r.url !== url) return r.url
  } catch {}
  return null
}

export const debridEnabled = !!DEBRID_KEY

export type DebridResult = { url: string; label: string; language: string }

const MAX_TRIES = 4

export async function resolveDebridStream(
  type: 'movie' | 'tv',
  tmdbId: number,
  lang: 'original' | 'latino',
  season?: number,
  episode?: number
): Promise<DebridResult | null> {
  if (!DEBRID_KEY) return null

  const imdbId = await imdbIdOf(type, tmdbId)
  if (!imdbId) return null

  const streams = await fetchStreams(imdbId, type, season, episode)
  const candidates = rankCandidates(streams, lang)
  if (!candidates.length) return null

  for (const c of candidates.slice(0, MAX_TRIES)) {
    const finalUrl = await followResolveUrl(c.resolveUrl)
    if (finalUrl) {
      return { url: finalUrl, label: c.label, language: c.latino ? 'Español Latino' : 'Original' }
    }
  }
  return null
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
  const mp4 = streams.filter(isMp4)
  return {
    imdbId,
    debridEnabled,
    totalStreams: streams.length,
    mp4Count: mp4.length,
    top: rankCandidates(streams, 'original')
      .slice(0, 8)
      .map((c) => ({ label: c.label, latino: c.latino })),
  }
}
