import { api } from './api'

export type StreamResult = {
  url: string
  headers: Record<string, string>
  source: string
}

export const stream = {
  movie: (id: string | number) => api<StreamResult>(`/resolve/movie/${id}`),
  tv: (id: string | number, season: number, episode: number) =>
    api<StreamResult>(`/resolve/tv/${id}/${season}/${episode}`),
}
