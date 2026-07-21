import { api } from './api'

const IMG_BASE = 'https://image.tmdb.org/t/p'

export function posterUrl(path: string | null, size: 'w342' | 'w500' = 'w342') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

export function backdropUrl(
  path: string | null,
  size: 'w300' | 'w780' | 'w1280' | 'original' = 'w780'
) {
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
  genre_ids?: number[]
  // Solo presentes en resultados de tipo 'person' (búsqueda multi de TMDB).
  profile_path?: string | null
  known_for_department?: string
  known_for?: MediaItem[]
  popularity?: number
}

const GENRE_NAMES: Record<number, string> = {
  28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen',
  99: 'Documental', 18: 'Drama', 10751: 'Familia', 14: 'Fantasía', 36: 'Historia',
  27: 'Terror', 10402: 'Música', 9648: 'Misterio', 10749: 'Romance',
  878: 'Ciencia ficción', 53: 'Suspenso', 10752: 'Bélica', 37: 'Western',
  10759: 'Acción y Aventura', 10762: 'Infantil', 10764: 'Reality',
  10765: 'Sci-Fi y Fantasía', 10766: 'Telenovela', 10768: 'Guerra y Política',
}

export function genreNames(ids?: number[], max = 2) {
  if (!ids) return []
  return ids.map((id) => GENRE_NAMES[id]).filter(Boolean).slice(0, max)
}

export type Paged<T> = { results: T[]; page: number; total_pages: number }

export type Category = {
  name: string
  type: 'movie' | 'tv'
  genreId: number
  backdrop_path: string | null
}

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
  // Clasificación por edad — movies vienen en release_dates, series en content_ratings
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] }
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] }
}

export function profileUrl(path: string | null, size: 'w185' | 'h632' = 'w185') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

export type PersonCredit = MediaItem & { character?: string }
export type PersonDetails = {
  id: number
  name: string
  biography: string
  profile_path: string | null
  birthday: string | null
  place_of_birth: string | null
  known_for_department: string
  combined_credits: { cast: PersonCredit[] }
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

export type GenreDetail = {
  hero: string | null
  popular: MediaItem[]
  topRated: MediaItem[]
  recent: MediaItem[]
}

// Catálogo de estudio/marca (Disney, HBO...). Misma forma que GenreDetail más
// el nombre y el tipo predominante de la marca.
export type StudioDetail = GenreDetail & {
  name: string
  type: 'movie' | 'tv'
}

export type GenreRow = { name: string; results: MediaItem[] }
// Fila por plataforma; `key` enlaza al catálogo de marca (/studio/[key]).
export type ProviderRow = { name: string; key: string; results: MediaItem[] }
export type CatalogData = {
  trending: Paged<MediaItem>
  popular: Paged<MediaItem>
  topRated: Paged<MediaItem>
  genres: GenreRow[]
  // Opcionales a propósito: el cliente puede estar desplegado antes que la API
  // (Vercel va por su lado), y una API vieja no devuelve estos campos. Marcarlos
  // opcionales obliga a manejar ese hueco en vez de crashear.
  recent?: Paged<MediaItem>
  classics?: Paged<MediaItem>
  providers?: ProviderRow[]
}

export const tmdb = {
  home: () => api<HomeData>('/tmdb/home'),
  collections: () => api<Collections>('/tmdb/collections'),
  movies: () => api<CatalogData>('/tmdb/movies'),
  series: () => api<CatalogData>('/tmdb/series'),
  search: (q: string) =>
    api<Paged<MediaItem>>(`/tmdb/search?q=${encodeURIComponent(q)}`),
  categories: () => api<Category[]>('/tmdb/categories'),
  discover: (type: 'movie' | 'tv', genreId: string | number) =>
    api<Paged<MediaItem>>(`/tmdb/discover/${type}/${genreId}`),
  genre: (type: 'movie' | 'tv', id: string | number) =>
    api<GenreDetail>(`/tmdb/genre/${type}/${id}`),
  studio: (key: string) => api<StudioDetail>(`/tmdb/studio/${key}`),
  movie: (id: string) => api<MediaDetails>(`/tmdb/movie/${id}`),
  tv: (id: string) => api<MediaDetails>(`/tmdb/tv/${id}`),
  season: (id: string, season: number) =>
    api<SeasonDetail>(`/tmdb/tv/${id}/season/${season}`),
  logo: (type: 'movie' | 'tv', id: number) =>
    api<{ logo: string | null }>(`/tmdb/images/${type}/${id}`),
  person: (id: string) => api<PersonDetails>(`/tmdb/person/${id}`),
}

export function logoUrl(path: string | null, size: 'w500' = 'w500') {
  return path ? `${IMG_BASE}/${size}${path}` : null
}

// TMDB para stills solo ofrece w92/w185/w300/original (no hay w780): para que
// se vean nítidos en una TV grande hay que pedir 'original'.
export function stillUrl(path: string | null, size: 'w300' | 'original' = 'w300') {
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

// Clasificación por edad ("18", "PG-13", "TV-MA"...): prioriza España, luego EE.UU.,
// luego cualquier país con dato. Devuelve null si TMDB no reporta ninguna.
export function certificationOf(data: MediaDetails): string | null {
  if (data.release_dates?.results?.length) {
    const byCountry = (cc: string) =>
      data.release_dates!.results
        .find((r) => r.iso_3166_1 === cc)
        ?.release_dates.map((d) => d.certification)
        .find((c) => c)
    return byCountry('ES') ?? byCountry('US')
      ?? data.release_dates.results.flatMap((r) => r.release_dates.map((d) => d.certification)).find((c) => c)
      ?? null
  }

  if (data.content_ratings?.results?.length) {
    const byCountry = (cc: string) =>
      data.content_ratings!.results.find((r) => r.iso_3166_1 === cc)?.rating
    return byCountry('ES') ?? byCountry('US')
      ?? data.content_ratings.results.map((r) => r.rating).find((c) => c)
      ?? null
  }

  return null
}
