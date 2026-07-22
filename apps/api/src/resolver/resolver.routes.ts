import { Elysia, t } from 'elysia'
import {
  resolveStream, checkProviders, debugScrape, debugSubs, debugDebrid,
  listSources, resolvePickedSource, type AudioLang,
} from './resolver.service'
import { langCode } from './hls'
import type { HwTier } from './torrentio.parse'

function parseLang(v?: string): AudioLang {
  return v === 'latino' ? 'latino' : 'original'
}

// Capacidad de decode del dispositivo. 'low' = Fire TV Stick y afines (poca RAM,
// sin decoder 4K/HEVC-10bit por hardware) → el resolver les evita ese contenido.
function parseHwTier(v?: string): HwTier {
  return v === 'low' ? 'low' : 'high'
}

// Fuentes a saltar (las que el cliente ya intentó y fallaron al reproducir)
function parseExclude(v?: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
}

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
  // Subtítulos con su código ISO (para react-native-video textTracks). El cliente
  // construye la URL /stream/sub.vtt usando el índice (mismo orden que result.captions)
  // como fallback, pero para fuentes VLC (mp4/mkv) prefiere bajar directo desde
  // `url`/`altUrls` — dl.opensubtitles.org bloquea las IPs de Vercel (datacenter)
  // por Cloudflare, pero no bloquea la IP del propio teléfono.
  const subtitles = result.captions
    .map((c, i) => ({ i, label: c.language, lang: langCode(c.language), url: c.url, altUrls: c.altUrls ?? [] }))
    .filter((s) => s.lang !== 'und')   // solo idiomas reconocidos
  return {
    streamUrl: result.url,
    type: result.type,                 // 'hls' (proxeado) | 'file' (mp4 directo)
    referer: cdnReferer || result.headers.Referer || '',
    source: result.source,
    language: result.language,         // etiqueta de idioma de audio ("Español Latino" / "Original")
    subtitles,
    hasLatinoAlternative: result.hasLatinoAlternative ?? false,
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

  // Diagnóstico de subtítulos: fetch crudo a Wyzie
  .get(
    '/debug/subs/movie/:id',
    ({ params, query }) => debugSubs('movie', Number(params.id), undefined, undefined, (query as { source?: string }).source),
    { params: t.Object({ id: t.String() }), query: t.Object({ source: t.Optional(t.String()) }) }
  )
  .get(
    '/debug/subs/tv/:id/:season/:episode',
    ({ params, query }) => debugSubs('tv', Number(params.id), Number(params.season), Number(params.episode), (query as { source?: string }).source),
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }), query: t.Object({ source: t.Optional(t.String()) }) }
  )

  // Diagnóstico: candidatos de Torrentio (mp4 rankeados) sin resolver el link final
  .get(
    '/debug/debrid/movie/:id',
    ({ params }) => debugDebrid('movie', Number(params.id)),
    { params: t.Object({ id: t.String() }) }
  )
  .get(
    '/debug/debrid/tv/:id/:season/:episode',
    ({ params }) => debugDebrid('tv', Number(params.id), Number(params.season), Number(params.episode)),
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }) }
  )

  // ── Selector de calidad ──
  // Lista de fuentes disponibles. No devuelve URLs: el cliente elige por
  // índice y el servidor resuelve (la URL de Torrentio lleva la clave de
  // Real-Debrid en el path).
  .get(
    '/sources/movie/:id',
    ({ params, query }) => listSources('movie', Number(params.id), undefined, undefined, parseLang(query.lang), parseHwTier(query.hw)),
    { params: t.Object({ id: t.String() }), query: t.Object({ lang: t.Optional(t.String()), hw: t.Optional(t.String()) }) }
  )
  .get(
    '/sources/tv/:id/:season/:episode',
    ({ params, query }) => listSources('tv', Number(params.id), Number(params.season), Number(params.episode), parseLang(query.lang), parseHwTier(query.hw)),
    {
      params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }),
      query: t.Object({ lang: t.Optional(t.String()), hw: t.Optional(t.String()) }),
    }
  )
  .get(
    '/pick/movie/:id',
    async ({ params, query, set }) => {
      const result = await resolvePickedSource('movie', Number(params.id), Number(query.i), undefined, undefined, parseLang(query.lang), parseHwTier(query.hw))
      const summary = summarize(result)
      if (!summary) { set.status = 404; return { error: 'Esa fuente no se pudo abrir' } }
      return summary
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ i: t.String(), lang: t.Optional(t.String()), hw: t.Optional(t.String()) }),
    }
  )
  .get(
    '/pick/tv/:id/:season/:episode',
    async ({ params, query, set }) => {
      const result = await resolvePickedSource('tv', Number(params.id), Number(query.i), Number(params.season), Number(params.episode), parseLang(query.lang), parseHwTier(query.hw))
      const summary = summarize(result)
      if (!summary) { set.status = 404; return { error: 'Esa fuente no se pudo abrir' } }
      return summary
    },
    {
      params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }),
      query: t.Object({ i: t.String(), lang: t.Optional(t.String()), hw: t.Optional(t.String()) }),
    }
  )

  .get(
    '/movie/:id',
    async ({ params, query, set }) => {
      const lang = parseLang(query.lang)
      const exclude = parseExclude(query.exclude)
      const result = await resolveStream('movie', Number(params.id), undefined, undefined, lang, exclude, parseHwTier(query.hw))
      console.error(`[resolve] movie ${params.id} (${lang}) →`, result?.source ?? 'null')
      const summary = summarize(result)
      if (!summary) {
        set.status = 404
        return { error: 'No se encontró stream para esta película' }
      }
      return summary
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ lang: t.Optional(t.String()), exclude: t.Optional(t.String()), hw: t.Optional(t.String()) }),
    }
  )

  .get(
    '/tv/:id/:season/:episode',
    async ({ params, query, set }) => {
      const lang = parseLang(query.lang)
      const exclude = parseExclude(query.exclude)
      const result = await resolveStream(
        'tv',
        Number(params.id),
        Number(params.season),
        Number(params.episode),
        lang,
        exclude,
        parseHwTier(query.hw)
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
      query: t.Object({ lang: t.Optional(t.String()), exclude: t.Optional(t.String()), hw: t.Optional(t.String()) }),
    }
  )
