import { Elysia, t } from 'elysia'
import { resolveStream, checkProviders, type Caption } from './resolver.service'
import { TTLCache } from './cache'
import { langCode, srtToVtt, resolveRelativeUrls } from './hls'

const HLS_MIME = 'application/vnd.apple.mpegurl'

function normalizeVtt(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('WEBVTT')) return `WEBVTT\n\n${trimmed}`
  const lines = trimmed.split('\n')
  const out: string[] = [lines[0]]
  let i = 1
  while (i < lines.length) {
    if (lines[i].trimStart().startsWith('WEBVTT')) { i++; continue }
    out.push(lines[i]); i++
  }
  return out.join('\n')
}

const playlistCache = new TTLCache<string>(60 * 60 * 1000) // 1h

type Query = { type: string; id: string; season?: string; episode?: string; lang?: string }

function resolveFromQuery(q: Query) {
  return resolveStream(
    q.type === 'tv' ? 'tv' : 'movie',
    Number(q.id),
    q.season ? Number(q.season) : undefined,
    q.episode ? Number(q.episode) : undefined,
    q.lang === 'latino' ? 'latino' : 'original'
  )
}

function qs(q: Query) {
  return `type=${q.type}&id=${q.id}&season=${q.season ?? ''}&episode=${q.episode ?? ''}&lang=${q.lang ?? ''}`
}

function baseUrl(request: Request): string {
  const host = request.headers.get('host') ?? 'localhost:3000'
  const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  const proto = (!isLocal || process.env.VERCEL) ? 'https' : 'http'
  return `${proto}://${host}`
}

// Referer que el CDN espera (movie-web lo entrega en headers/preferredHeaders)
function refererOf(headers: Record<string, string>): string {
  return headers.Referer ?? headers.referer ?? ''
}

// Descarga un m3u8 desde el CDN con los headers correctos (Referer/Origin/etc.)
async function fetchM3u8(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const raw = await fetch(url, {
      headers,
      signal: AbortSignal.timeout?.(12000),
    }).then((r) => r.text())
    return raw.trimStart().startsWith('#EXTM3U') ? raw : null
  } catch (e) {
    console.error(`[m3u8] fetch error ${url.slice(-50)}: ${(e as Error).message}`)
    return null
  }
}

// Reescribe todas las URLs de un m3u8 (segmentos) para pasar por nuestro servidor.
// referer se pasa directo en la URL — no necesita lookup por segmento.
function rewriteAllUrls(m3u8: string, baseM3u8Url: string, proxyBase: string, referer: string): string {
  const base = baseM3u8Url.slice(0, baseM3u8Url.lastIndexOf('/') + 1)
  const origin = new URL(baseM3u8Url).origin
  const lines = m3u8.split('\n')
  const out: string[] = []

  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) { out.push(line); continue }
    let abs = t
    if (!t.startsWith('http')) {
      abs = t.startsWith('/') ? `${origin}${t}` : `${base}${t}`
    }
    out.push(`${proxyBase}/stream/seg?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`)
  }
  return out.join('\n')
}

// Reescribe solo las líneas de variante en un master (líneas después de #EXT-X-STREAM-INF).
// queryStr = "type=tv&id=123&season=1&episode=2" — se propaga a las rutas hijas.
function rewriteMasterVariants(master: string, baseUrl2: string, proxyBase: string, subLines: string[], queryStr: string): string {
  const base = baseUrl2.slice(0, baseUrl2.lastIndexOf('/') + 1)
  const origin = new URL(baseUrl2).origin
  const lines = master.split('\n')
  const out: string[] = ['#EXTM3U']

  for (const s of subLines) out.push(s)

  const hasSubs = subLines.length > 0
  let nextIsVariant = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || t === '#EXTM3U') continue

    if (t.startsWith('#EXT-X-STREAM-INF:')) {
      const withSubs = hasSubs && !t.includes('SUBTITLES=')
        ? t + ',SUBTITLES="subs"'
        : t
      out.push(withSubs)
      nextIsVariant = true
      continue
    }

    if (nextIsVariant && !t.startsWith('#')) {
      nextIsVariant = false
      let abs = t
      if (!t.startsWith('http')) {
        abs = t.startsWith('/') ? `${origin}${t}` : `${base}${t}`
      }
      out.push(`${proxyBase}/stream/variant.m3u8?${queryStr}&url=${encodeURIComponent(abs)}`)
      continue
    }

    // Pistas alternativas (audio Latino/Original, subtítulos embebidos): reescribir su URI
    // para que pasen por el proxy → el selector nativo de audio/subtítulos funciona.
    if (t.startsWith('#EXT-X-MEDIA:') && t.includes('URI="')) {
      nextIsVariant = false
      out.push(
        t.replace(/URI="([^"]+)"/, (_m, uri) => {
          let abs = uri
          if (!uri.startsWith('http')) {
            abs = uri.startsWith('/') ? `${origin}${uri}` : `${base}${uri}`
          }
          return `URI="${proxyBase}/stream/variant.m3u8?${queryStr}&url=${encodeURIComponent(abs)}"`
        })
      )
      continue
    }

    nextIsVariant = false
    out.push(line)
  }
  return out.join('\n')
}

export const streamRoutes = new Elysia({ prefix: '/stream' })
  .get('/health', async () => {
    const providers = await checkProviders()
    return { healthy: providers.some((p) => p.ok), providers }
  })

  // Master playlist: variantes reescritas para pasar por nuestro servidor
  .get(
    '/master.m3u8',
    async ({ query, request, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) { set.status = 404; return 'No stream' }

      const base = baseUrl(request)
      const query_string = qs(query as Query)
      const cacheKey = `master2:${query_string}`

      const headers = result.headers as Record<string, string>
      const referer = refererOf(headers)

      const playlist = await playlistCache.resolve(cacheKey, async () => {
        const subLines = result.captions.map((c: Caption, i: number) => {
          const code = langCode(c.language)
          const name = c.language.replace(/"/g, '')
          const uri = `${base}/stream/sub.m3u8?${query_string}&i=${i}`
          return `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}",LANGUAGE="${code}",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="${uri}"`
        })
        const hasSubs = subLines.length > 0

        // Stream tipo file (mp4): no hay playlist → un solo "variant" que apunta al mp4
        if (result.type === 'file') {
          const varUrl = `${base}/stream/seg?url=${encodeURIComponent(result.url)}&referer=${encodeURIComponent(referer)}`
          const subsAttr = hasSubs ? ',SUBTITLES="subs"' : ''
          let fb = '#EXTM3U\n'
          if (hasSubs) fb += subLines.join('\n') + '\n'
          fb += `#EXT-X-STREAM-INF:BANDWIDTH=4000000${subsAttr}\n${varUrl}\n`
          return fb
        }

        // HLS: descargar el playlist desde el CDN con los headers correctos
        const masterRaw = await fetchM3u8(result.url, headers)
        if (!masterRaw) {
          // No se pudo bajar el m3u8 → fallback a un único variant proxeado
          const varUrl = `${base}/stream/seg?url=${encodeURIComponent(result.url)}&referer=${encodeURIComponent(referer)}`
          const subsAttr = hasSubs ? ',SUBTITLES="subs"' : ''
          let fb = '#EXTM3U\n'
          if (hasSubs) fb += subLines.join('\n') + '\n'
          fb += `#EXT-X-STREAM-INF:BANDWIDTH=4000000${subsAttr}\n${varUrl}\n`
          return fb
        }

        const resolved = resolveRelativeUrls(masterRaw, result.url)

        // ¿Es un master (con variantes) o un media playlist (segmentos directos)?
        if (resolved.includes('#EXT-X-STREAM-INF')) {
          return rewriteMasterVariants(resolved, result.url, base, subLines, query_string)
        }
        // Media playlist: segmentos directos → un solo variant que envuelve este playlist
        const varUrl = `${base}/stream/variant.m3u8?${query_string}&url=${encodeURIComponent(result.url)}`
        const subsAttr = hasSubs ? ',SUBTITLES="subs"' : ''
        let fb = '#EXTM3U\n'
        if (hasSubs) fb += subLines.join('\n') + '\n'
        fb += `#EXT-X-STREAM-INF:BANDWIDTH=4000000${subsAttr}\n${varUrl}\n`
        return fb
      })

      set.headers['content-type'] = HLS_MIME
      return playlist
    },
    {
      query: t.Object({
        type: t.String(), id: t.String(),
        season: t.Optional(t.String()), episode: t.Optional(t.String()),
        lang: t.Optional(t.String()),
      }),
    }
  )

  // Variante HLS: sirve el contenido capturado en el browser, con segmentos proxeados
  .get(
    '/variant.m3u8',
    async ({ query, request, set }) => {
      const q = query as Query & { url: string }
      if (!q.url) { set.status = 400; return 'No url' }

      const streamResult = await resolveFromQuery(q)
      if (!streamResult) { set.status = 404; return 'No stream' }

      const variantUrl = decodeURIComponent(q.url)
      const base = baseUrl(request)
      const headers = streamResult.headers as Record<string, string>
      const referer = refererOf(headers)

      // Descargar el variant playlist desde el CDN con los headers correctos
      const raw = await fetchM3u8(variantUrl, headers)
      if (raw) {
        const resolved = resolveRelativeUrls(raw, variantUrl)
        const rewritten = rewriteAllUrls(resolved, variantUrl, base, referer)
        set.headers['content-type'] = HLS_MIME
        return rewritten
      }

      set.status = 502
      return 'Variant not available'
    },
    {
      query: t.Object({
        type: t.String(), id: t.String(),
        season: t.Optional(t.String()), episode: t.Optional(t.String()),
        lang: t.Optional(t.String()),
        url: t.String(),
      }),
    }
  )

  // Proxy de segmentos (TS binario) — usa referer del query param, sin lookup de stream.
  .get(
    '/seg',
    async ({ query, set }) => {
      const q = query as { url: string; referer?: string }
      if (!q.url) { set.status = 400; return 'No url' }

      const segUrl = decodeURIComponent(q.url)
      const referer = q.referer ? decodeURIComponent(q.referer) : ''
      const headers: Record<string, string> = referer ? { Referer: referer } : {}

      try {
        const resp = await fetch(segUrl, {
          headers,
          signal: AbortSignal.timeout?.(30000),
        })
        if (!resp.ok) {
          console.error(`[seg] CDN returned ${resp.status} for ${segUrl.slice(-60)}`)
          set.status = resp.status
          return `CDN error ${resp.status}`
        }
        const ct = resp.headers.get('content-type') ?? 'video/mp2t'
        set.headers['content-type'] = ct
        set.headers['cache-control'] = 'public, max-age=3600'
        return new Uint8Array(await resp.arrayBuffer())
      } catch (e) {
        console.error(`[seg] fetch error: ${(e as Error).message}`)
        set.status = 502
        return 'Segment fetch failed'
      }
    },
    {
      query: t.Object({
        url: t.String(),
        referer: t.Optional(t.String()),
      }),
    }
  )

  // Pista de subtítulos (VTT)
  .get(
    '/sub.m3u8',
    async ({ query, request, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) { set.status = 404; return 'No stream' }

      const q = query as Query & { i: string }
      const idx = Number(q.i ?? 0)
      const cap = result.captions[idx]
      if (!cap) { set.status = 404; return 'No caption' }

      const base = baseUrl(request)
      const qs_str = qs(q)
      const vttUrl = `${base}/stream/sub.vtt?${qs_str}&i=${idx}`

      set.headers['content-type'] = HLS_MIME
      return `#EXTM3U\n#EXT-X-TARGETDURATION:99999\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:99999.0,\n${vttUrl}\n#EXT-X-ENDLIST`
    },
    {
      query: t.Object({
        type: t.String(), id: t.String(),
        season: t.Optional(t.String()), episode: t.Optional(t.String()),
        lang: t.Optional(t.String()),
        i: t.String(),
      }),
    }
  )

  .get(
    '/sub.vtt',
    async ({ query, set }) => {
      const result = await resolveFromQuery(query as Query)
      if (!result) { set.status = 404; return 'No stream' }

      const q = query as Query & { i: string }
      const idx = Number(q.i ?? 0)
      const cap = result.captions[idx]
      if (!cap) { set.status = 404; return 'No caption' }

      const referer = result.headers.Referer ?? ''
      const fetchSub = (url: string) =>
        fetch(url, { headers: referer ? { Referer: referer } : {} }).then((r) => r.text())

      const raw = cap.url.startsWith('http') ? await fetchSub(cap.url) : cap.url
      const vtt = raw.trimStart().startsWith('WEBVTT') ? normalizeVtt(raw) : srtToVtt(raw)

      set.headers['content-type'] = 'text/vtt'
      return vtt
    },
    {
      query: t.Object({
        type: t.String(), id: t.String(),
        season: t.Optional(t.String()), episode: t.Optional(t.String()),
        lang: t.Optional(t.String()),
        i: t.String(),
      }),
    }
  )
