import { Elysia, t } from 'elysia'
import { resolveStream, checkProviders } from './resolver.service'

// Devuelve metadata de resolución (calienta el cache + subtítulos + referer)
function summarize(result: Awaited<ReturnType<typeof resolveStream>>) {
  if (!result) return null
  return {
    source: result.source,
    captions: result.captions.map((c) => c.language),
    referer: result.headers.Referer,
  }
}

export const resolverRoutes = new Elysia({ prefix: '/resolve' })
  // Diagnóstico: estado de cada proveedor (prueba con Fight Club)
  .get('/health', async () => {
    const providers = await checkProviders()
    const upTier1 = providers.some((p) => p.tier === 1 && p.ok)
    return {
      healthy: providers.some((p) => p.ok),
      tier1Up: upTier1,
      providers,
    }
  })

  .get(
    '/movie/:id',
    async ({ params, set }) => {
      const result = await resolveStream('movie', Number(params.id))
      const summary = summarize(result)
      if (!summary) {
        set.status = 404
        return { error: 'No se encontró stream para esta película' }
      }
      return summary
    },
    { params: t.Object({ id: t.String() }) }
  )

  .get(
    '/tv/:id/:season/:episode',
    async ({ params, set }) => {
      const result = await resolveStream(
        'tv',
        Number(params.id),
        Number(params.season),
        Number(params.episode)
      )
      const summary = summarize(result)
      if (!summary) {
        set.status = 404
        return { error: 'No se encontró stream para este capítulo' }
      }
      return summary
    },
    {
      params: t.Object({
        id: t.String(),
        season: t.String(),
        episode: t.String(),
      }),
    }
  )
