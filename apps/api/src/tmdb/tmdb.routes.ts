import { Elysia, t } from 'elysia'
import { tmdbService } from './tmdb.service'

export const tmdbRoutes = new Elysia({ prefix: '/tmdb' })
  // Inicio: varias filas en una sola llamada
  .get('/home', async () => {
    const [trending, popularMovies, popularSeries, topMovies] =
      await Promise.all([
        tmdbService.trending(),
        tmdbService.popularMovies(),
        tmdbService.popularSeries(),
        tmdbService.topRatedMovies(),
      ])
    return { trending, popularMovies, popularSeries, topMovies }
  })

  // Películas: tendencias + populares + mejor valoradas + filas por género
  .get('/movies', async () => {
    const GENRES: [string, number][] = [
      ['Acción', 28],
      ['Comedia', 35],
      ['Terror', 27],
      ['Ciencia ficción', 878],
      ['Animación', 16],
      ['Drama', 18],
      ['Romance', 10749],
    ]
    const [trending, popular, topRated, ...genreResults] = await Promise.all([
      tmdbService.trendingMovies(),
      tmdbService.popularMovies(),
      tmdbService.topRatedMovies(),
      ...GENRES.map(([, id]) => tmdbService.discoverByGenre(id, 'movie')),
    ])
    const genres = GENRES.map(([name], i) => ({ name, results: (genreResults[i] as any).results }))
    return { trending, popular, topRated, genres }
  })

  // Series: tendencias + populares + mejor valoradas + filas por género
  .get('/series', async () => {
    const GENRES: [string, number][] = [
      ['Drama', 18],
      ['Comedia', 35],
      ['Crimen', 80],
      ['Sci-Fi y Fantasía', 10765],
      ['Acción y Aventura', 10759],
      ['Animación', 16],
      ['Misterio', 9648],
    ]
    const [trending, popular, topRated, ...genreResults] = await Promise.all([
      tmdbService.trendingSeries(),
      tmdbService.popularSeries(),
      tmdbService.topRatedSeries(),
      ...GENRES.map(([, id]) => tmdbService.discoverByGenre(id, 'tv')),
    ])
    const genres = GENRES.map(([name], i) => ({ name, results: (genreResults[i] as any).results }))
    return { trending, popular, topRated, genres }
  })

  // Colecciones por plataforma (Netflix, Apple TV+, HBO Max, Disney+, Prime)
  .get('/collections', async () => {
    const [netflix, appletv, hbo, disney, prime] = await Promise.all([
      tmdbService.discoverByProvider(8), // Netflix
      tmdbService.discoverByProvider(350, 'tv'), // Apple TV+ (más series)
      tmdbService.discoverByProvider(1899), // HBO Max / Max
      tmdbService.discoverByProvider(337), // Disney+
      tmdbService.discoverByProvider(9), // Amazon Prime Video
    ])
    return { netflix, appletv, hbo, disney, prime }
  })

  // Logo (PNG) del título para el hero — prioriza español, luego inglés
  .get(
    '/images/:type/:id',
    async ({ params }) => {
      const type = params.type === 'tv' ? 'tv' : 'movie'
      const data: any = await tmdbService.images(type, Number(params.id))
      const logos: any[] = data?.logos ?? []
      const pick =
        logos.find((l) => l.iso_639_1 === 'es') ??
        logos.find((l) => l.iso_639_1 === 'en') ??
        logos[0]
      return { logo: pick?.file_path ?? null }
    },
    { params: t.Object({ type: t.String(), id: t.String() }) }
  )

  // Búsqueda
  .get(
    '/search',
    ({ query }) => tmdbService.searchMulti(query.q ?? '', Number(query.page ?? 1)),
    { query: t.Object({ q: t.String(), page: t.Optional(t.String()) }) }
  )

  // Detalle de película
  .get('/movie/:id', ({ params }) => tmdbService.movieDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  // Detalle de serie
  .get('/tv/:id', ({ params }) => tmdbService.tvDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  // Temporada de serie (capítulos)
  .get(
    '/tv/:id/season/:season',
    ({ params }) =>
      tmdbService.tvSeason(Number(params.id), Number(params.season)),
    { params: t.Object({ id: t.String(), season: t.String() }) }
  )
