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

// Valor por el que ordena un `sort_by` de TMDB, leído del item. TMDB nombra el
// campo distinto al del item (primary_release_date → release_date), por eso el
// mapeo explícito. Sirve para re-ordenar resultados de varias regiones ya
// mezcladas manteniendo el mismo criterio que pidió el discover.
function sortValue(sortBy: string, it: any): number | string {
  if (sortBy.startsWith('vote_average')) return it.vote_average ?? 0
  if (sortBy.startsWith('primary_release_date')) return it.release_date ?? ''
  if (sortBy.startsWith('first_air_date')) return it.first_air_date ?? ''
  return it.popularity ?? 0
}

// Dedupe por id (un título en MX y US aparece dos veces) + reordena por el
// criterio del discover. Fechas 'YYYY-MM-DD' ordenan lexicográficamente igual
// que cronológicamente, así que el mismo comparador desc sirve para todo.
function dedupeSort(items: any[], sortBy: string): any[] {
  const seen = new Set<number>()
  const out: any[] = []
  for (const it of items) {
    if (it?.id != null && !seen.has(it.id)) {
      seen.add(it.id)
      out.push(it)
    }
  }
  return out.sort((a, b) => {
    const av = sortValue(sortBy, a)
    const bv = sortValue(sortBy, b)
    return av < bv ? 1 : av > bv ? -1 : 0
  })
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

  // Catálogo de estudio/marca (Disney, HBO, Marvel...): por plataforma (watch
  // provider) o por productora(s) (company). Devuelve el array de resultados ya
  // dedupeado y ordenado. Para plataformas mezcla VARIAS regiones (MX + US): un
  // título puede estar en la plataforma en México pero no en EE.UU. y viceversa,
  // así el catálogo cubre lo máximo. Para franquicias acepta múltiples company
  // IDs (OR con `|`) — una sola productora deja fuera muchos títulos.
  discoverBrand: async (opts: {
    type: 'movie' | 'tv'
    sortBy: string
    providerId?: number
    companies?: number[]
    regions?: string[]
  }): Promise<any[]> => {
    const isDate = /release_date|air_date/.test(opts.sortBy)
    const common: TMDBParams = {
      sort_by: opts.sortBy,
      page: 1,
      // Rating exige más votos (evita 10/10 con 12 votos); populares/recientes,
      // un piso bajo para no vaciar catálogos de marca chicos.
      'vote_count.gte': opts.sortBy.startsWith('vote_average') ? 100 : 20,
      with_companies: opts.companies?.length ? opts.companies.join('|') : undefined,
    }
    // "Recientes" sin fecha tope se llenaba de estrenos futuros sin póster.
    if (isDate) {
      common[opts.type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] =
        new Date().toISOString().slice(0, 10)
    }

    if (opts.providerId) {
      const regions = opts.regions ?? ['MX', 'US']
      const settled = await Promise.allSettled(
        regions.map((r) =>
          tmdb<any>(`/discover/${opts.type}`, {
            ...common,
            with_watch_providers: opts.providerId,
            watch_region: r,
            watch_monetization_types: 'flatrate',
          })
        )
      )
      const merged = settled.flatMap((s) =>
        s.status === 'fulfilled' ? (s.value.results ?? []) : []
      )
      return dedupeSort(merged, opts.sortBy)
    }

    const res = await tmdb<any>(`/discover/${opts.type}`, common)
    return res.results ?? []
  },

  // Descubrir genérico ordenado, sin filtrar por género — para filas temáticas
  // (recién estrenadas, clásicos aclamados...). `params` permite acotar por
  // fecha o exigir más votos según el caso.
  discoverSorted: (
    type: 'movie' | 'tv',
    sortBy: string,
    params: TMDBParams = {}
  ) =>
    tmdb(`/discover/${type}`, {
      sort_by: sortBy,
      page: 1,
      ...params,
    }),

  // Detalle (videos en es+en para maximizar tráilers disponibles).
  // release_dates/content_ratings traen la clasificación por edad (ES/US) para el badge del player.
  movieDetails: (id: number) =>
    tmdb(`/movie/${id}`, {
      append_to_response: 'credits,videos,similar,release_dates',
      include_video_language: 'es,en',
    }),
  tvDetails: (id: number) =>
    tmdb(`/tv/${id}`, {
      append_to_response: 'credits,videos,similar,content_ratings',
      include_video_language: 'es,en',
    }),
  tvSeason: (id: number, season: number) =>
    tmdb(`/tv/${id}/season/${season}`),

  // IMDb id — lo necesita Torrentio (indexa por imdb, no por tmdb)
  externalIds: (type: 'movie' | 'tv', id: number) =>
    tmdb(`/${type}/${id}/external_ids`),

  // Logos (PNG transparente) del título, en varios idiomas
  images: (type: 'movie' | 'tv', id: number) =>
    tmdb(`/${type}/${id}/images`, { include_image_language: 'es,en,null' }),

  // Persona (actor/director) + su filmografía
  personDetails: (id: number) =>
    tmdb(`/person/${id}`, { append_to_response: 'combined_credits' }),
}
