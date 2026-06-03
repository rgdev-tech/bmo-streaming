import { Elysia, t } from 'elysia'
import { resolveStream } from './resolver.service'

export const resolverRoutes = new Elysia({ prefix: '/resolve' })
  // Película
  .get(
    '/movie/:id',
    async ({ params, set }) => {
      const result = await resolveStream('movie', Number(params.id))
      if (!result) {
        set.status = 404
        return { error: 'No se encontró stream para esta película' }
      }
      return result
    },
    { params: t.Object({ id: t.String() }) }
  )

  // Serie (temporada / capítulo)
  .get(
    '/tv/:id/:season/:episode',
    async ({ params, set }) => {
      const result = await resolveStream(
        'tv',
        Number(params.id),
        Number(params.season),
        Number(params.episode)
      )
      if (!result) {
        set.status = 404
        return { error: 'No se encontró stream para este capítulo' }
      }
      return result
    },
    {
      params: t.Object({
        id: t.String(),
        season: t.String(),
        episode: t.String(),
      }),
    }
  )
