import { Elysia, t } from 'elysia'
import { resolveStream, checkProviders, debugScrape } from './resolver.service'

// Algunos CDNs (vidlink → storm.vodvidl.site) incluyen en el query param ?headers=
// el Referer que esperan recibir del cliente. Lo extraemos para dárselo al player.
function extractCdnReferer(streamUrl: string): string {
  try {
    const url = new URL(streamUrl)
    const raw = url.searchParams.get('headers')
    if (raw) {
      const hdrs = JSON.parse(decodeURIComponent(raw))
      if (typeof hdrs?.referer === 'string' && hdrs.referer) return hdrs.referer
    }
  } catch {}
  return ''
}

// Devuelve metadata de resolución (calienta el cache + subtítulos + referer)
function summarize(result: Awaited<ReturnType<typeof resolveStream>>) {
  if (!result) return null
  // Prefiere el referer embebido en el CDN URL (más preciso) sobre el del embed page
  const cdnReferer = extractCdnReferer(result.url)
  return {
    streamUrl: result.url,
    referer: cdnReferer || result.headers.Referer || '',
    source: result.source,
    captions: result.captions.map((c) => c.language),
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

  // Diagnóstico: corre el scrape y devuelve qué hizo cada source (JSON crudo)
  .get(
    '/debug/movie/:id',
    ({ params }) => debugScrape('movie', Number(params.id)),
    { params: t.Object({ id: t.String() }) }
  )
  .get(
    '/debug/tv/:id/:season/:episode',
    ({ params }) => debugScrape('tv', Number(params.id), Number(params.season), Number(params.episode)),
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }) }
  )

  .get(
    '/movie/:id',
    async ({ params, set }) => {
      console.error(`[resolve] movie ${params.id} start`)
      const result = await resolveStream('movie', Number(params.id))
      console.error(`[resolve] movie ${params.id} result:`, result?.source ?? 'null')
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
