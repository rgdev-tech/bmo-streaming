import AsyncStorage from '@react-native-async-storage/async-storage'
import { api, API_URL } from './api'

// Idioma de audio preferido. 'original' = idioma original (con subtítulos);
// 'latino' = prioriza fuentes con doblaje en español latino.
export type AudioLang = 'original' | 'latino'

const AUDIO_LANG_KEY = 'bmo:audioLang'

export async function getAudioLang(): Promise<AudioLang> {
  try {
    const v = await AsyncStorage.getItem(AUDIO_LANG_KEY)
    return v === 'latino' ? 'latino' : 'original'
  } catch {
    return 'original'
  }
}

export function setAudioLang(lang: AudioLang): void {
  AsyncStorage.setItem(AUDIO_LANG_KEY, lang).catch(() => {})
}

export type ResolveInfo = {
  streamUrl: string   // URL directa del CDN
  type: 'hls' | 'file'  // hls → master proxeado; file → mp4 directo
  referer: string
  source: string
  language: string    // etiqueta del idioma de audio resuelto ("Español Latino" / "Original")
  captions: string[]
}

const RESOLVE_TIMEOUT = 55_000  // 55s — el scraper puede tardar pero no más que esto

const langQ = (lang: AudioLang) => (lang === 'latino' ? '&lang=latino' : '')

export const stream = {
  resolveMovie: (id: string | number, lang: AudioLang = 'original') =>
    api<ResolveInfo>(`/resolve/movie/${id}?lang=${lang}`, RESOLVE_TIMEOUT),
  resolveTv: (id: string | number, season: number, episode: number, lang: AudioLang = 'original') =>
    api<ResolveInfo>(`/resolve/tv/${id}/${season}/${episode}?lang=${lang}`, RESOLVE_TIMEOUT),

  // Master HLS proxeado por nuestro servidor (variantes + segmentos + subs)
  masterMovie: (id: string | number, lang: AudioLang = 'original') =>
    `${API_URL}/stream/master.m3u8?type=movie&id=${id}${langQ(lang)}`,
  masterTv: (id: string | number, season: number, episode: number, lang: AudioLang = 'original') =>
    `${API_URL}/stream/master.m3u8?type=tv&id=${id}&season=${season}&episode=${episode}${langQ(lang)}`,

  // Pre-resuelve un stream en segundo plano (calienta el cache del API).
  prewarm: (type: 'movie' | 'tv', id: string | number, season?: number, episode?: number, lang: AudioLang = 'original') => {
    const p = type === 'tv'
      ? api(`/resolve/tv/${id}/${season ?? 1}/${episode ?? 1}?lang=${lang}`)
      : api(`/resolve/movie/${id}?lang=${lang}`)
    p.catch(() => {})
  },
}
