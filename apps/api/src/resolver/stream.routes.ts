import { Elysia, t } from 'elysia'
import { resolveStream, type Caption } from './resolver.service'
import { TTLCache } from './cache'
import { langCode, srtToVtt, rewriteMaster } from './hls'

const HLS_MIME = 'application/vnd.apple.mpegurl'

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

function baseUrl(host: string | null) {
  return `http://${host ?? 'localhost:3000'}`
}

function qs(q: Query) {
  const p = new URLSearchParams({ type: q.type, id: q.id })
  if (q.season) p.set('season', q.season)
  if (q.episode) p.set('episode', q.episode)
  return p.toString()
}

export const streamRoutes = new Elysia({ prefix: '/stream' })
  // Master playlist con subtítulos inyectados como pistas HLS
  .get(
    '/master.m3u8',
    async ({ query, request, set }) => {
      const result = await resolveFromQuery(query)
      if (!result) {
        set.status = 404
        return 'No stream'
      }

      const base = baseUrl(request.headers.get('host'))
      const query_string = qs(query)
      const cacheKey = `playlist:${query_string}`

      const playlist = await playlistCache.resolve(cacheKey, async () => {
        // Descarga el master original del CDN (con el Referer requerido)
        const orig = await fetch(result.url, {
          headers: result.headers,
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

  // Playlist de un subtítulo (envuelve el VTT en HLS VOD)
  .get(
    '/sub.m3u8',
    async ({ query, request, set }) => {
      const base = baseUrl(request.headers.get('host'))
      const vtt = `${base}/stream/sub.vtt?${qs(query)}&i=${query.i}`
      set.headers['content-type'] = HLS_MIME
      return [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:86400',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXTINF:86400.0,',
        vtt,
        '#EXT-X-ENDLIST',
      ].join('\n')
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

  // El archivo de subtítulo en sí (proxy + normaliza a WebVTT)
  .get(
    '/sub.vtt',
    async ({ query, set }) => {
      const result = await resolveFromQuery(query)
      const caption = result?.captions[Number(query.i)]
      if (!caption) {
        set.status = 404
        return 'No subtitle'
      }

      let text = await fetch(caption.url).then((r) => r.text())
      if (!text.trimStart().startsWith('WEBVTT')) {
        text = srtToVtt(text)
      }

      set.headers['content-type'] = 'text/vtt; charset=utf-8'
      return text
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
