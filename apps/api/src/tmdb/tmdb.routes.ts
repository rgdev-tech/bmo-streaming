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

  // Detalle de persona (actor) con filmografía
  .get('/person/:id', ({ params }) => tmdbService.personDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
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

  // Categorías para la pantalla de Buscar (género + arte representativo)
  .get('/categories', async () => {
    const CATS: [string, 'movie' | 'tv', number][] = [
      ['Acción', 'movie', 28],
      ['Comedia', 'movie', 35],
      ['Terror', 'movie', 27],
      ['Ciencia ficción', 'movie', 878],
      ['Animación', 'movie', 16],
      ['Drama', 'movie', 18],
      ['Crimen', 'tv', 80],
      ['Romance', 'movie', 10749],
      ['Aventura', 'movie', 12],
      ['Documentales', 'movie', 99],
      ['Familia', 'movie', 10751],
      ['Suspenso', 'movie', 53],
      ['Fantasía', 'movie', 14],
      ['Misterio', 'movie', 9648],
      ['Historia', 'movie', 36],
      ['Música', 'movie', 10402],
      ['Bélico', 'movie', 10752],
      ['Western', 'movie', 37],
      ['Reality', 'tv', 10764],
      ['Series acción', 'tv', 10759],
      ['Sci-Fi & Fantasy', 'tv', 10765],
      ['Infantil', 'tv', 10762],
      ['Guerra y política', 'tv', 10768],
      ['Telenovelas', 'tv', 10766],
    ]
    const results = await Promise.all(
      CATS.map(([, type, id]) => tmdbService.discoverByGenre(id, type))
    )
    return CATS.map(([name, type, genreId], i) => {
      const list = (results[i] as any).results as any[]
      const art = list.find((x) => x.backdrop_path) ?? list[0]
      return { name, type, genreId, backdrop_path: art?.backdrop_path ?? null }
    })
  })

  // Secciones para la pantalla de categoría estilo Apple TV
  .get(
    '/genre/:type/:id',
    async ({ params }) => {
      const type = params.type === 'tv' ? 'tv' : 'movie'
      const genreId = Number(params.id)
      const recentSort = type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'
      const [popular, topRated, recent] = await Promise.all([
        tmdbService.discoverByGenre(genreId, type),
        tmdbService.discoverByGenreSorted(genreId, type, 'vote_average.desc'),
        tmdbService.discoverByGenreSorted(genreId, type, recentSort),
      ])
      const pop = (popular as any).results as any[]
      const hero = pop.find((x: any) => x.backdrop_path)?.backdrop_path ?? null
      return {
        hero,
        popular: pop,
        topRated: (topRated as any).results,
        recent: (recent as any).results,
      }
    },
    { params: t.Object({ type: t.String(), id: t.String() }) }
  )

  // Discover por género (cuadrícula de una categoría)
  .get(
    '/discover/:type/:genreId',
    ({ params }) =>
      tmdbService.discoverByGenre(
        Number(params.genreId),
        params.type === 'tv' ? 'tv' : 'movie'
      ),
    { params: t.Object({ type: t.String(), genreId: t.String() }) }
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
