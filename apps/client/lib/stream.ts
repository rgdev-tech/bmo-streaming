import AsyncStorage from '@react-native-async-storage/async-storage'
import { api, API_URL } from './api'
import { getContinueWatching } from './library'

// Idioma de audio preferido. 'original' = idioma original (con subtítulos);
// 'latino' = prioriza fuentes con doblaje en español latino.
export type AudioLang = 'original' | 'latino'

const AUDIO_LANG_KEY = 'bmo:audioLang'

export async function getAudioLang(): Promise<AudioLang> {
  try {
    const v = await AsyncStorage.getItem(AUDIO_LANG_KEY)
    // Sin preferencia guardada todavía (primer uso) → default a latino, no a
    // original. Solo cae a 'original' si el usuario lo eligió explícitamente.
    return v === 'original' ? 'original' : 'latino'
  } catch {
    return 'latino'
  }
}

export function setAudioLang(lang: AudioLang): void {
  AsyncStorage.setItem(AUDIO_LANG_KEY, lang).catch(() => {})
}

export type Subtitle = { i: number; label: string; lang: string }

export type ResolveInfo = {
  streamUrl: string   // URL directa del CDN
  type: 'hls' | 'file'  // hls → master proxeado; file → mp4 directo
  referer: string
  source: string
  language: string    // etiqueta del idioma de audio resuelto ("Español Latino" / "Original")
  subtitles: Subtitle[]
  hasLatinoAlternative: boolean  // hay un torrent con audio latino disponible (aunque este resultado no lo sea)
}

const RESOLVE_TIMEOUT = 55_000  // 55s — el scraper puede tardar pero no más que esto

const langQ = (lang: AudioLang) => (lang === 'latino' ? '&lang=latino' : '')
// Fuentes que fallaron al reproducir → el servidor las salta y prueba la siguiente
const exQ = (exclude?: string[]) => (exclude && exclude.length ? `&exclude=${exclude.join(',')}` : '')

export const stream = {
  resolveMovie: (id: string | number, lang: AudioLang = 'original', exclude?: string[]) =>
    api<ResolveInfo>(`/resolve/movie/${id}?lang=${lang}${exQ(exclude)}`, RESOLVE_TIMEOUT),
  resolveTv: (id: string | number, season: number, episode: number, lang: AudioLang = 'original', exclude?: string[]) =>
    api<ResolveInfo>(`/resolve/tv/${id}/${season}/${episode}?lang=${lang}${exQ(exclude)}`, RESOLVE_TIMEOUT),

  // Master HLS proxeado por nuestro servidor (variantes + segmentos + subs)
  masterMovie: (id: string | number, lang: AudioLang = 'original', exclude?: string[]) =>
    `${API_URL}/stream/master.m3u8?type=movie&id=${id}${langQ(lang)}${exQ(exclude)}`,
  masterTv: (id: string | number, season: number, episode: number, lang: AudioLang = 'original', exclude?: string[]) =>
    `${API_URL}/stream/master.m3u8?type=tv&id=${id}&season=${season}&episode=${episode}${langQ(lang)}${exQ(exclude)}`,

  // URL VTT de un subtítulo (servida/convertida por nuestro API) — para textTracks
  subVtt: (
    type: 'movie' | 'tv', id: string | number, i: number,
    season?: number, episode?: number, lang: AudioLang = 'original',
  ) => {
    const q = type === 'tv'
      ? `type=tv&id=${id}&season=${season ?? 1}&episode=${episode ?? 1}`
      : `type=movie&id=${id}&season=&episode=`
    return `${API_URL}/stream/sub.vtt?${q}&i=${i}&lang=${lang}`
  },

  // Pre-resuelve un stream en segundo plano (calienta el cache del API).
  prewarm: (type: 'movie' | 'tv', id: string | number, season?: number, episode?: number, lang: AudioLang = 'original') => {
    const p = type === 'tv'
      ? api(`/resolve/tv/${id}/${season ?? 1}/${episode ?? 1}?lang=${lang}`)
      : api(`/resolve/movie/${id}?lang=${lang}`)
    p.catch(() => {})
  },
}

// Precalienta el título ni bien el dedo toca el póster/tarjeta — antes de que
// termine la transición a la pantalla de detalle o de player. Usa la
// preferencia de idioma real (si no matchea la que pide el player después, la
// key de cache no pega y el pre-warm queda inútil). Para series sin
// season/episode explícito (viene de una fila genérica, no de "Seguir
// viendo"), busca si ya hay progreso guardado para no precalentar siempre S1E1.
export function prewarmTitle(
  id: number,
  isTv: boolean,
  season?: number,
  episode?: number
): void {
  ;(async () => {
    const lang = await getAudioLang()
    if (!isTv) {
      stream.resolveMovie(id, lang).catch(() => {})
      return
    }
    let s = season
    let e = episode
    if (s == null || e == null) {
      try {
        const watching = await getContinueWatching()
        const match = watching.find(
          (p) => p.id === id && p.media_type === 'tv' && p.season && p.episode
        )
        if (match) {
          s = match.season
          e = match.episode
        }
      } catch {}
    }
    stream.resolveTv(id, s ?? 1, e ?? 1, lang).catch(() => {})
  })()
}
