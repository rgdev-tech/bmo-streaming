import {
  stream,
  type AudioLang,
  type ResolveInfo,
  type SourceOption,
} from '@bmo/core/stream'
import type { MediaMeta, TrackLike } from './types'

// Sufijo "· T_:E_" que las pantallas de detalle agregan al título. Se guarda y se
// muestra sin él (la temporada/episodio ya van aparte); el regex saca uno o más
// al final para limpiar también títulos ya viciados ("· T9:E2 · T9:E2…").
const EPISODE_SUFFIX = /(?:\s*·\s*T\d+:E\d+)+\s*$/

export function stripEpisodeSuffix(title: string): string {
  return title.replace(EPISODE_SUFFIX, '')
}

// "T1 · E3" para series; undefined para películas.
export function episodeLabel(isTv: boolean, season?: number, episode?: number): string | undefined {
  return isTv ? `T${season ?? 1} · E${episode ?? 1}` : undefined
}

// Duración legible: "1:02:03" o "12:34".
export function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// ¿Esta pista (audio o subtítulo) es española? Se mira el código de idioma
// (ISO 639) y, como respaldo, la etiqueta legible — muchos MKV no titulan las
// pistas pero sí las etiquetan por idioma.
export function isSpanish(t: TrackLike): boolean {
  const lang = (t.language ?? '').toLowerCase()
  if (lang.startsWith('es') || lang.startsWith('spa')) return true
  return /\b(?:spa|esp|spanish|español|castellano|latino)\b/i.test(t.label ?? '')
}

// Etiqueta legible de una fuente: "4K · HDR · HEVC · 12.4 GB". El nombre de
// archivo crudo va debajo como línea secundaria.
export function describeSource(s: SourceOption): string {
  const parts: string[] = []
  parts.push(
    s.resolution === 2160 ? '4K'
    : s.resolution ? `${s.resolution}p`
    : 'Calidad desconocida'
  )
  if (s.hdr && s.hdr !== 'none') parts.push(s.hdr === 'dv' ? 'Dolby Vision' : 'HDR')
  if (s.codec) parts.push(s.codec === 'hevc' ? 'HEVC' : s.codec === 'h264' ? 'H.264' : s.codec.toUpperCase())
  if (s.langs.includes('latino')) parts.push('Latino')
  if (s.sizeGB != null) parts.push(s.sizeGB >= 1 ? `${s.sizeGB.toFixed(1)} GB` : `${Math.round(s.sizeGB * 1024)} MB`)
  return parts.join('  ·  ')
}

// URI a reproducir según el tipo de fuente:
//  - 'hls'  → master proxeado por nuestro API (variantes + segmentos + subs). Se
//    re-resuelve en el servidor con el MISMO `exclude`/`audioLang` para que elija
//    la fuente ya validada por el cliente.
//  - 'file' → URL directa del CDN (mkv/HEVC/mp4).
export function resolvePlaybackUri(
  info: ResolveInfo,
  meta: MediaMeta,
  audioLang: AudioLang,
  excluded: string[]
): string {
  if (info.type !== 'hls') return info.streamUrl
  return meta.media_type === 'tv'
    ? stream.masterTv(meta.id, meta.season ?? 1, meta.episode ?? 1, audioLang, excluded)
    : stream.masterMovie(meta.id, audioLang, excluded)
}
