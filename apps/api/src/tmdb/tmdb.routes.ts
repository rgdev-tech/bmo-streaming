import { Elysia, t } from 'elysia'
import { tmdbService } from './tmdb.service'
import { TTLCache } from '../resolver/cache'

const CATALOG_TTL = 30 * 60_000   // 30 min
const cache = new TTLCache<unknown>(CATALOG_TTL)

// Marcas/estudios reconocidos en el buscador. `providerId` = plataforma de
// streaming (watch provider); `companyId` = productora. `type` marca si la
// marca se luce más con pelis o series. Las claves deben coincidir con
// STUDIO_BRANDS del cliente (lib/studios.ts).
const STUDIOS: Record<
  string,
  { name: string; type: 'movie' | 'tv'; providerId?: number; companyId?: number }
> = {
  disney: { name: 'Disney+', type: 'movie', providerId: 337 },
  hbo: { name: 'HBO Max', type: 'tv', providerId: 1899 },
  netflix: { name: 'Netflix', type: 'tv', providerId: 8 },
  prime: { name: 'Prime Video', type: 'movie', providerId: 9 },
  appletv: { name: 'Apple TV+', type: 'tv', providerId: 350 },
  marvel: { name: 'Marvel', type: 'movie', companyId: 420 },
  dc: { name: 'DC', type: 'movie', companyId: 429 },
  pixar: { name: 'Pixar', type: 'movie', companyId: 3 },
  starwars: { name: 'Star Wars', type: 'movie', companyId: 1 },
  // Paramount+ como watch-provider viene vacío en TMDB → usamos la productora.
  paramount: { name: 'Paramount', type: 'movie', companyId: 4 },
  warner: { name: 'Warner Bros.', type: 'movie', companyId: 174 },
  universal: { name: 'Universal', type: 'movie', companyId: 33 },
  dreamworks: { name: 'DreamWorks', type: 'movie', companyId: 521 },
}

async function safeGenres(
  genres: [string, number][],
  type: 'movie' | 'tv'
): Promise<{ name: string; results: any[] }[]> {
  const results = await Promise.allSettled(
    genres.map(([, id]) => tmdbService.discoverByGenre(id, type))
  )
  return genres
    .map(([name], i) => ({
      name,
      results: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<any>).value.results ?? [] : [],
    }))
    .filter((g) => g.results.length > 0)
}

// Filas por plataforma. Devuelve además la `key` del estudio para que el
// cliente pueda enlazar el título de la fila al catálogo de esa marca
// (ver STUDIOS y /tmdb/studio/:key).
async function safeProviders(
  providers: [string, string, number][],
  type: 'movie' | 'tv'
): Promise<{ name: string; key: string; results: any[] }[]> {
  const results = await Promise.allSettled(
    providers.map(([, , id]) => tmdbService.discoverByProvider(id, type))
  )
  return providers
    .map(([name, key], i) => ({
      name,
      key,
      results: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<any>).value.results ?? [] : [],
    }))
    .filter((p) => p.results.length > 0)
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export const tmdbRoutes = new Elysia({ prefix: '/tmdb' })
  // Inicio: varias filas en una sola llamada
  .get('/home', () =>
    cache.resolve('home', async () => {
      const [trending, popularMovies, popularSeries, topMovies] =
        await Promise.all([
          tmdbService.trending(),
          tmdbService.popularMovies(),
          tmdbService.popularSeries(),
          tmdbService.topRatedMovies(),
        ])
      return { trending, popularMovies, popularSeries, topMovies }
    })
  )

  // Películas: tendencias + populares + mejor valoradas + filas por género
  .get('/movies', () =>
    cache.resolve('movies', async () => {
      const GENRES: [string, number][] = [
        ['Acción', 28],
        ['Comedia', 35],
        ['Terror', 27],
        ['Ciencia ficción', 878],
        ['Animación', 16],
        ['Drama', 18],
        ['Romance', 10749],
        ['Aventura', 12],
        ['Suspenso', 53],
        ['Fantasía', 14],
        ['Crimen', 80],
        ['Familia', 10751],
      ]
      const PROVIDERS: [string, string, number][] = [
        ['Netflix', 'netflix', 8],
        ['Disney+', 'disney', 337],
        ['Prime Video', 'prime', 9],
        ['HBO Max', 'hbo', 1899],
      ]
      const [trending, popular, topRated, recent, classics, providers, genres] =
        await Promise.all([
          tmdbService.trendingMovies(),
          tmdbService.popularMovies(),
          tmdbService.topRatedMovies(),
          // Estrenadas ya (lte hoy) — sin el tope de fecha se llenaba de
          // títulos futuros sin pósters ni valoraciones.
          tmdbService.discoverSorted('movie', 'primary_release_date.desc', {
            'primary_release_date.lte': todayISO(),
            'vote_count.gte': 30,
          }),
          tmdbService.discoverSorted('movie', 'vote_average.desc', {
            'primary_release_date.lte': '2005-12-31',
            'vote_count.gte': 1500,
          }),
          safeProviders(PROVIDERS, 'movie'),
          safeGenres(GENRES, 'movie'),
        ])
      return { trending, popular, topRated, recent, classics, providers, genres }
    })
  )

  // Series: tendencias + populares + mejor valoradas + filas por género
  .get('/series', () =>
    cache.resolve('series', async () => {
      const GENRES: [string, number][] = [
        ['Drama', 18],
        ['Comedia', 35],
        ['Crimen', 80],
        ['Sci-Fi y Fantasía', 10765],
        ['Acción y Aventura', 10759],
        ['Animación', 16],
        ['Misterio', 9648],
        ['Documental', 99],
        ['Familia', 10751],
        ['Infantil', 10762],
        ['Reality', 10764],
        ['Guerra y política', 10768],
      ]
      const PROVIDERS: [string, string, number][] = [
        ['Netflix', 'netflix', 8],
        ['HBO Max', 'hbo', 1899],
        ['Disney+', 'disney', 337],
        ['Apple TV+', 'appletv', 350],
      ]
      const [trending, popular, topRated, recent, classics, providers, genres] =
        await Promise.all([
          tmdbService.trendingSeries(),
          tmdbService.popularSeries(),
          tmdbService.topRatedSeries(),
          tmdbService.discoverSorted('tv', 'first_air_date.desc', {
            'first_air_date.lte': todayISO(),
            'vote_count.gte': 30,
          }),
          tmdbService.discoverSorted('tv', 'vote_average.desc', {
            'first_air_date.lte': '2010-12-31',
            'vote_count.gte': 800,
          }),
          safeProviders(PROVIDERS, 'tv'),
          safeGenres(GENRES, 'tv'),
        ])
      return { trending, popular, topRated, recent, classics, providers, genres }
    })
  )

  // Colecciones por plataforma (Netflix, Apple TV+, HBO Max, Disney+, Prime)
  .get('/collections', () =>
    cache.resolve('collections', async () => {
      const [netflix, appletv, hbo, disney, prime] = await Promise.all([
        tmdbService.discoverByProvider(8),
        tmdbService.discoverByProvider(350, 'tv'),
        tmdbService.discoverByProvider(1899),
        tmdbService.discoverByProvider(337),
        tmdbService.discoverByProvider(9),
      ])
      return { netflix, appletv, hbo, disney, prime }
    })
  )

  // Catálogo especial de un estudio / marca (Disney, HBO, Marvel...). La misma
  // forma que /genre (hero + populares + top + recientes) para reusar el
  // layout de catálogo en el cliente. `type` indica si la marca se representa
  // mejor con pelis o series.
  .get(
    '/studio/:key',
    ({ params }) =>
      cache.resolve(`studio:${params.key.toLowerCase()}`, async () => {
        const s = STUDIOS[params.key.toLowerCase()]
        if (!s) return { name: params.key, type: 'movie', hero: null, popular: [], topRated: [], recent: [] }
        const recentSort = s.type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'
        const base = { companyId: s.companyId, providerId: s.providerId, type: s.type }
        const [popular, topRated, recent] = await Promise.all([
          tmdbService.discoverStudio({ ...base, sortBy: 'popularity.desc' }),
          tmdbService.discoverStudio({ ...base, sortBy: 'vote_average.desc' }),
          tmdbService.discoverStudio({ ...base, sortBy: recentSort }),
        ])
        const pop = (popular as any).results as any[]
        const hero = pop.find((x: any) => x.backdrop_path)?.backdrop_path ?? null
        return {
          name: s.name,
          type: s.type,
          hero,
          popular: pop,
          topRated: (topRated as any).results,
          recent: (recent as any).results,
        }
      }),
    { params: t.Object({ key: t.String() }) }
  )

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
  .get('/categories', () =>
    cache.resolve('categories', async () => {
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
      const results = await Promise.allSettled(
        CATS.map(([, type, id]) => tmdbService.discoverByGenre(id, type))
      )
      return CATS.map(([name, type, genreId], i) => {
        const list: any[] =
          results[i].status === 'fulfilled'
            ? ((results[i] as PromiseFulfilledResult<any>).value.results ?? [])
            : []
        const art = list.find((x: any) => x.backdrop_path) ?? list[0]
        return { name, type, genreId, backdrop_path: art?.backdrop_path ?? null }
      }).filter((c) => c.backdrop_path)
    })
  )

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
