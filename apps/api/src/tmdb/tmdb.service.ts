const TMDB_BASE = 'https://api.themoviedb.org/3'
const LANG = 'es-ES'

const API_KEY = process.env.TMDB_API_KEY ?? ''

if (!API_KEY) {
  console.warn('⚠️  TMDB_API_KEY no configurada — define apps/api/.env')
}

type TMDBParams = Record<string, string | number | undefined>

async function tmdb<T>(path: string, params: TMDBParams = {}): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('language', LANG)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`TMDB ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

export const tmdbService = {
  // Filas para la pantalla de inicio
  trending: () => tmdb('/trending/all/week'),
  popularMovies: (page = 1) => tmdb('/movie/popular', { page }),
  topRatedMovies: (page = 1) => tmdb('/movie/top_rated', { page }),
  popularSeries: (page = 1) => tmdb('/tv/popular', { page }),
  topRatedSeries: (page = 1) => tmdb('/tv/top_rated', { page }),

  // Búsqueda
  searchMulti: (query: string, page = 1) =>
    tmdb('/search/multi', { query, page, include_adult: 'false' }),

  trendingMovies: () => tmdb('/trending/movie/week'),
  trendingSeries: () => tmdb('/trending/tv/week'),

  // Descubrir por género
  discoverByGenre: (genreId: number, type: 'movie' | 'tv' = 'movie', page = 1) =>
    tmdb(`/discover/${type}`, {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page,
      'vote_count.gte': 100,
    }),

  discoverByGenreSorted: (genreId: number, type: 'movie' | 'tv', sortBy: string) =>
    tmdb(`/discover/${type}`, {
      with_genres: genreId,
      sort_by: sortBy,
      page: 1,
      'vote_count.gte': 50,
    }),

  // Descubrir por plataforma (watch provider)
  discoverByProvider: (
    providerId: number,
    type: 'movie' | 'tv' = 'movie',
    region = 'US'
  ) =>
    tmdb(`/discover/${type}`, {
      with_watch_providers: providerId,
      watch_region: region,
      sort_by: 'popularity.desc',
      watch_monetization_types: 'flatrate',
    }),

  // Detalle (videos en es+en para maximizar tráilers disponibles)
  movieDetails: (id: number) =>
    tmdb(`/movie/${id}`, {
      append_to_response: 'credits,videos,similar',
      include_video_language: 'es,en',
    }),
  tvDetails: (id: number) =>
    tmdb(`/tv/${id}`, {
      append_to_response: 'credits,videos,similar',
      include_video_language: 'es,en',
    }),
  tvSeason: (id: number, season: number) =>
    tmdb(`/tv/${id}/season/${season}`),

  // Logos (PNG transparente) del título, en varios idiomas
  images: (type: 'movie' | 'tv', id: number) =>
    tmdb(`/${type}/${id}/images`, { include_image_language: 'es,en,null' }),

  // Persona (actor/director) + su filmografía
  personDetails: (id: number) =>
    tmdb(`/person/${id}`, { append_to_response: 'combined_credits' }),
}
