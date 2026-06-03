import { api } from './api'

const IMG_BASE = 'https://image.tmdb.org/t/p'

export function posterUrl(path: string | null, size: 'w342' | 'w500' = 'w342') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

export function backdropUrl(path: string | null, size: 'w780' | 'w1280' = 'w780') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

export type MediaItem = {
  id: number
  title?: string
  name?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  vote_average: number
  media_type?: 'movie' | 'tv' | 'person'
  release_date?: string
  first_air_date?: string
}

export type Paged<T> = { results: T[]; page: number; total_pages: number }

export type HomeData = {
  trending: Paged<MediaItem>
  popularMovies: Paged<MediaItem>
  popularSeries: Paged<MediaItem>
  topMovies: Paged<MediaItem>
}

export type Genre = { id: number; name: string }
export type Season = {
  id: number
  season_number: number
  name: string
  episode_count: number
  poster_path: string | null
}

export type CastMember = {
  id: number
  name: string
  character: string
  profile_path: string | null
}

export type Video = {
  key: string
  site: string
  type: string
  name: string
}

export type MediaDetails = MediaItem & {
  genres: Genre[]
  runtime?: number
  number_of_seasons?: number
  seasons?: Season[]
  tagline?: string
  credits?: { cast: CastMember[] }
  videos?: { results: Video[] }
  similar?: Paged<MediaItem>
}

export function profileUrl(path: string | null, size: 'w185' = 'w185') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

// Busca el mejor tráiler de YouTube (Trailer > Teaser)
export function trailerKey(videos?: Video[]): string | null {
  if (!videos?.length) return null
  const yt = videos.filter((v) => v.site === 'YouTube')
  const trailer = yt.find((v) => v.type === 'Trailer') ?? yt.find((v) => v.type === 'Teaser') ?? yt[0]
  return trailer?.key ?? null
}

export type Episode = {
  id: number
  episode_number: number
  name: string
  overview: string
  still_path: string | null
  runtime: number | null
  air_date: string | null
}

export type SeasonDetail = {
  id: number
  name: string
  season_number: number
  episodes: Episode[]
}

export type Collections = {
  netflix: Paged<MediaItem>
  appletv: Paged<MediaItem>
  hbo: Paged<MediaItem>
  disney: Paged<MediaItem>
  prime: Paged<MediaItem>
}

export const tmdb = {
  home: () => api<HomeData>('/tmdb/home'),
  collections: () => api<Collections>('/tmdb/collections'),
  movies: () =>
    api<{ popular: Paged<MediaItem>; topRated: Paged<MediaItem> }>('/tmdb/movies'),
  series: () =>
    api<{ popular: Paged<MediaItem>; topRated: Paged<MediaItem> }>('/tmdb/series'),
  search: (q: string) =>
    api<Paged<MediaItem>>(`/tmdb/search?q=${encodeURIComponent(q)}`),
  movie: (id: string) => api<MediaDetails>(`/tmdb/movie/${id}`),
  tv: (id: string) => api<MediaDetails>(`/tmdb/tv/${id}`),
  season: (id: string, season: number) =>
    api<SeasonDetail>(`/tmdb/tv/${id}/season/${season}`),
}

export function stillUrl(path: string | null, size: 'w300' = 'w300') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

export function yearOf(item: MediaItem) {
  const date = item.release_date ?? item.first_air_date ?? ''
  return date.slice(0, 4)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Estrenado = tiene fecha y ya pasó. Sin fecha o fecha futura = próximamente.
export function isReleased(date?: string | null) {
  return !!date && date <= todayISO()
}

export function isUpcoming(item: MediaItem) {
  return !isReleased(item.release_date ?? item.first_air_date)
}

export function titleOf(item: MediaItem) {
  return item.title ?? item.name ?? 'Sin título'
}
