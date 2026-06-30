import { api, API_URL } from './api'

export type ResolveInfo = {
  streamUrl: string   // URL directa del CDN — el player la usa sin pasar por el servidor
  referer: string
  source: string
  captions: string[]
}

const RESOLVE_TIMEOUT = 55_000  // 55s — el scraper puede tardar pero no más que esto

export const stream = {
  resolveMovie: (id: string | number) => api<ResolveInfo>(`/resolve/movie/${id}`, RESOLVE_TIMEOUT),
  resolveTv: (id: string | number, season: number, episode: number) =>
    api<ResolveInfo>(`/resolve/tv/${id}/${season}/${episode}`, RESOLVE_TIMEOUT),

  // Master HLS proxeado por nuestro servidor (variantes + segmentos + subs)
  masterMovie: (id: string | number) =>
    `${API_URL}/stream/master.m3u8?type=movie&id=${id}`,
  masterTv: (id: string | number, season: number, episode: number) =>
    `${API_URL}/stream/master.m3u8?type=tv&id=${id}&season=${season}&episode=${episode}`,

  // Pre-resuelve un stream en segundo plano (calienta el cache del API).
  prewarm: (type: 'movie' | 'tv', id: string | number, season?: number, episode?: number) => {
    const p = type === 'tv'
      ? api(`/resolve/tv/${id}/${season ?? 1}/${episode ?? 1}`)
      : api(`/resolve/movie/${id}`)
    p.catch(() => {})
  },
}
