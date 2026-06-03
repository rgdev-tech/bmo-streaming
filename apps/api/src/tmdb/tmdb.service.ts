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

  // Detalle
  movieDetails: (id: number) =>
    tmdb(`/movie/${id}`, { append_to_response: 'credits,videos,similar' }),
  tvDetails: (id: number) =>
    tmdb(`/tv/${id}`, { append_to_response: 'credits,videos,similar' }),
  tvSeason: (id: number, season: number) =>
    tmdb(`/tv/${id}/season/${season}`),
}
