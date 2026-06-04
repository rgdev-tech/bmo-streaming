import { Elysia, t } from 'elysia'
import { resolveStream, checkProviders, type Caption } from './resolver.service'
import { TTLCache } from './cache'
import { langCode, srtToVtt, rewriteMaster } from './hls'

const HLS_MIME = 'application/vnd.apple.mpegurl'

// Cachea el playlist procesado (con subs inyectados) para no re-descargar del CDN
const playlistCache = new TTLCache<string>(60 * 60 * 1000) // 1h

// Convierte URLs relativas del playlist a absolutas usando la URL del CDN
function absolutifyUrls(content: string, cdnUrl: string): string {
  const base = new URL(cdnUrl)
  const origin = base.origin // e.g. https://lunarleopardlife.net
  const dir = cdnUrl.substring(0, cdnUrl.lastIndexOf('/') + 1) // directory of the m3u8

  return content.split('\n').map((line) => {
    if (line.startsWith('#') || line.trim() === '') return line
    if (line.startsWith('http://') || line.startsWith('https://')) return line
    if (line.startsWith('/')) return `${origin}${line}`
    return `${dir}${line}`
  }).join('\n')
}

type Query = {
  type: string
  id: string
  season?: string
  episode?: string
}

function resolveFromQuery(q: Query) {
  return resolveStream(
    q.type === 'tv' ? 'tv' : 'movie',
    Number(q.id),
    q.season ? Number(q.season) : undefined,
    q.episode ? Number(q.episode) : undefined
  )
}

function qs(q: Query) {
  return `type=${q.type}&id=${q.id}&season=${q.season ?? ''}&episode=${q.episode ?? ''}`
}

function baseUrl(host?: string) {
  const h = host ?? 'localhost:3000'
  return `https://${h}`
}

export const streamRoutes = new Elysia({ prefix: '/stream' })
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

  // Master playlist con subtítulos inyectados
  .get(
    '/master.m3u8',
    async ({ query, request, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) {
        set.status = 404
        return 'No stream'
      }

      const base = baseUrl(request.headers.get('host') ?? undefined)
      const query_string = qs(query as Query)
      const cacheKey = `playlist:${query_string}`

      const playlist = await playlistCache.resolve(cacheKey, async () => {
        // Descarga el master original del CDN (con el Referer requerido)
        const headers = Object.fromEntries(
          Object.entries(result.headers).filter(([, v]) => v != null)
        ) as Record<string, string>
        const orig = await fetch(result.url, {
          headers,
          signal: AbortSignal.timeout(10000),
        }).then((r) => r.text())

        // Líneas #EXT-X-MEDIA para cada idioma de subtítulo
        const subLines = result.captions.map((c: Caption, i: number) => {
          const code = langCode(c.language)
          const name = c.language.replace(/"/g, '')
          const uri = `${base}/stream/sub.m3u8?${query_string}&i=${i}`
          return `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}",LANGUAGE="${code}",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="${uri}"`
        })

        return rewriteMaster(orig, subLines)
      })

      set.headers['content-type'] = HLS_MIME
      return playlist
    },
    {
      query: t.Object({
        type: t.String(),
        id: t.String(),
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
      }),
    }
  )

  // Pista de subtítulos (VTT convertido)
  .get(
    '/sub.m3u8',
    async ({ query, request, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) {
        set.status = 404
        return 'No stream'
      }

      const q = query as Query & { i: string }
      const idx = Number(q.i ?? 0)
      const cap = result.captions[idx]
      if (!cap) {
        set.status = 404
        return 'No caption'
      }

      const base = baseUrl(request.headers.get('host') ?? undefined)
      const qs_str = qs(q)

      const vttUrl = `${base}/stream/sub.vtt?${qs_str}`

      set.headers['content-type'] = HLS_MIME
      return `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.0,\n${vttUrl}`
    },
    {
      query: t.Object({
        type: t.String(),
        id: t.String(),
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
        i: t.String(),
      }),
    }
  )

  // Subtítulos en VTT
  .get(
    '/sub.vtt',
    async ({ query, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) {
        set.status = 404
        return 'No stream'
      }

      const q = query as Query & { i: string }
      const idx = Number(q.i ?? 0)
      const cap = result.captions[idx]
      if (!cap) {
        set.status = 404
        return 'No caption'
      }

      const vtt =
        cap.type === 'vtt'
          ? cap.url.startsWith('http')
            ? await fetch(cap.url).then((r) => r.text())
            : cap.url
          : srtToVtt(
              cap.url.startsWith('http')
                ? await fetch(cap.url).then((r) => r.text())
                : cap.url
            )

      set.headers['content-type'] = 'text/vtt'
      return vtt
    },
    {
      query: t.Object({
        type: t.String(),
        id: t.String(),
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
        i: t.String(),
      }),
    }
  )

  // Segmento HLS (relay hacia el CDN con headers requeridos)
  .get(
    '/segment',
    async ({ query, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) {
        set.status = 404
        return 'No stream'
      }

      const q = query as Query & { url: string }
      if (!q.url) {
        set.status = 400
        return 'No URL'
      }

      const headers = Object.fromEntries(
        Object.entries(result.headers).filter(([, v]) => v != null)
      ) as Record<string, string>
      const segment = await fetch(q.url, { headers }).catch((e) => {
        set.status = 503
        return { text: () => String(e) }
      })

      set.headers['content-type'] = 'video/mp2t'
      return await segment.text()
    },
    {
      query: t.Object({
        type: t.String(),
        id: t.String(),
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
        url: t.String(),
      }),
    }
  )

  // Endpoints públicos (sin auth)
  .get(
    '/movie/:id',
    ({ params }) => resolveFromQuery({ type: 'movie', id: params.id }),
    { params: t.Object({ id: t.String() }) }
  )
  .get(
    '/tv/:id/:season/:episode',
    ({ params }) =>
      resolveFromQuery({
        type: 'tv',
        id: params.id,
        season: params.season,
        episode: params.episode,
      }),
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }) }
  )
