import { Elysia, t } from 'elysia'
import { resolveStream, checkProviders, type Caption } from './resolver.service'
import { TTLCache } from './cache'
import { langCode, srtToVtt, rewriteMaster } from './hls'

const HLS_MIME = 'application/vnd.apple.mpegurl'

// Algunos CDNs devuelven VTT con doble header "WEBVTT". Lo normalizamos a uno solo.
function normalizeVtt(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('WEBVTT')) return `WEBVTT\n\n${trimmed}`
  // Partir en líneas, mantener la primera WEBVTT y descartar las repeticiones
  const lines = trimmed.split('\n')
  const out: string[] = [lines[0]] // primera línea = "WEBVTT ..."
  let i = 1
  while (i < lines.length) {
    if (lines[i].trimStart().startsWith('WEBVTT')) {
      i++ // saltar el header duplicado
    } else {
      out.push(lines[i])
      i++
    }
  }
  return out.join('\n')
}

// Cachea el playlist procesado (con subs inyectados) para no re-descargar del CDN
const playlistCache = new TTLCache<string>(60 * 60 * 1000) // 1h

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

function baseUrl(request: Request): string {
  const host = request.headers.get('host') ?? 'localhost:3000'
  // En Vercel siempre HTTPS; en local (IP privada o localhost) → HTTP
  const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  const proto = (!isLocal || process.env.VERCEL) ? 'https' : 'http'
  return `${proto}://${host}`
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

      const base = baseUrl(request)
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

      const base = baseUrl(request)
      const qs_str = qs(q)
      // i= debe incluirse para que sub.vtt sirva el idioma correcto
      const vttUrl = `${base}/stream/sub.vtt?${qs_str}&i=${idx}`

      set.headers['content-type'] = HLS_MIME
      // 99999s cubre cualquier película/serie — AVPlayer necesita que la duración
      // del segmento sea >= la duración real del archivo de subtítulos
      return `#EXTM3U\n#EXT-X-TARGETDURATION:99999\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:99999.0,\n${vttUrl}\n#EXT-X-ENDLIST`
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

      const referer = result.headers.Referer ?? ''
      const fetchSub = (url: string) =>
        fetch(url, { headers: referer ? { Referer: referer } : {} }).then((r) => r.text())

      const raw = cap.url.startsWith('http') ? await fetchSub(cap.url) : cap.url
      // Detectar por contenido real, no por el tipo declarado (vidlink devuelve type:'srt'
      // pero las URLs son .vtt y el contenido ya empieza con WEBVTT)
      const vtt = raw.trimStart().startsWith('WEBVTT') ? normalizeVtt(raw) : srtToVtt(raw)

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
      const resp = await fetch(q.url, { headers }).catch(() => null)
      if (!resp?.ok) {
        set.status = 502
        return 'Segment fetch failed'
      }

      set.headers['content-type'] = 'video/mp2t'
      return new Uint8Array(await resp.arrayBuffer())
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
