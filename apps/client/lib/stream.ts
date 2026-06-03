import { api, API_URL } from './api'

export type ResolveInfo = {
  source: string
  captions: string[]
  referer: string
}

export const stream = {
  // Calienta el cache y devuelve los idiomas de subtítulo disponibles
  resolveMovie: (id: string | number) => api<ResolveInfo>(`/resolve/movie/${id}`),
  resolveTv: (id: string | number, season: number, episode: number) =>
    api<ResolveInfo>(`/resolve/tv/${id}/${season}/${episode}`),

  // URL del master HLS con subtítulos inyectados (lo que reproduce el player)
  masterMovie: (id: string | number) =>
    `${API_URL}/stream/master.m3u8?type=movie&id=${id}`,
  masterTv: (id: string | number, season: number, episode: number) =>
    `${API_URL}/stream/master.m3u8?type=tv&id=${id}&season=${season}&episode=${episode}`,
}
