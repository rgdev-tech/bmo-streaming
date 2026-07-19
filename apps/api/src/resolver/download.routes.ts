import { Elysia, t } from 'elysia'
import { resolveStream } from './resolver.service'

function resolveUrl(href: string, base: string): string {
  if (href.startsWith('http')) return href
  if (href.startsWith('/')) return new URL(base).origin + href
  return base.slice(0, base.lastIndexOf('/') + 1) + href
}

// Para descarga elige la calidad MÁS BAJA disponible:
// mismos segmentos pero ~3x más pequeños → descarga 3x más rápida
function pickVariant(master: string, baseUrl: string): { url: string; quality: string } | null {
  const lines = master.split('\n')
  const variants: { bw: number; url: string }[] = []

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const bwMatch = line.match(/BANDWIDTH=(\d+)/)
    const bw = bwMatch ? Number(bwMatch[1]) : 0
    const rawUrl = lines[i + 1]?.trim()
    if (!rawUrl || rawUrl.startsWith('#')) continue
    variants.push({ bw, url: resolveUrl(rawUrl, baseUrl) })
  }

  if (!variants.length) return null
  // Ordenar por bitrate ascendente → tomar el más pequeño disponible
  variants.sort((a, b) => a.bw - b.bw)
  const v = variants[0]
  const quality = v.bw >= 3_000_000 ? '1080p' : v.bw >= 1_500_000 ? '720p' : v.bw >= 700_000 ? '480p' : '360p'
  return { url: v.url, quality }
}

type Segment = { url: string; duration: number }

function parseVariant(m3u8: string, baseUrl: string): Segment[] {
  const lines = m3u8.split('\n')
  const segments: Segment[] = []
  let dur = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF:')) {
      dur = parseFloat(line.slice(8).split(',')[0]) || 0
    } else if (line && !line.startsWith('#')) {
      segments.push({ url: resolveUrl(line, baseUrl), duration: dur })
      dur = 0
    }
  }
  return segments
}

async function buildSegmentList(
  streamUrl: string,
  referer: string
): Promise<{ segments: Segment[]; quality: string }> {
  const headers: Record<string, string> = referer ? { Referer: referer } : {}

  // 1. Descargar el master de la CDN
  const master = await fetch(streamUrl, { headers, signal: AbortSignal.timeout(10_000) }).then(r => r.text())

  // 2. Elegir variante
  const chosen = pickVariant(master, streamUrl)
  if (!chosen) throw new Error('No variant found')

  // 3. Descargar la variante
  const variant = await fetch(chosen.url, { headers, signal: AbortSignal.timeout(10_000) }).then(r => r.text())

  const segments = parseVariant(variant, chosen.url)
  return { segments, quality: chosen.quality }
}

// La calidad no viene en el StreamResult para fuentes 'file', pero el nombre
// del archivo de Real-Debrid casi siempre la lleva.
function qualityFromName(url: string): string {
  let name = url
  try { name = decodeURIComponent(new URL(url).pathname) } catch {}
  if (/2160p|\b4k\b/i.test(name)) return '2160p'
  if (/1080p/i.test(name)) return '1080p'
  if (/720p/i.test(name)) return '720p'
  if (/480p/i.test(name)) return '480p'
  return ''
}

// Respuesta discriminada por `kind`:
//   'file' → un único archivo directo (Real-Debrid): el cliente lo baja de una
//   'hls'  → lista de segmentos a bajar y recomponer en un m3u8 local
//
// Antes esto asumía SIEMPRE HLS: con una fuente 'file' hacía .text() sobre un
// MKV de varios GB para buscarle variantes, y la función moría por timeout.
// Desde que Real-Debrid es la fuente principal, eso rompía toda descarga.
async function buildPayload(result: NonNullable<Awaited<ReturnType<typeof resolveStream>>>) {
  const referer = result.headers.Referer ?? result.headers.referer ?? ''
  const common = { referer, captions: result.captions, source: result.source }

  if (result.type === 'file') {
    return { kind: 'file' as const, url: result.url, quality: qualityFromName(result.url), ...common }
  }
  const { segments, quality } = await buildSegmentList(result.url, referer)
  return { kind: 'hls' as const, segments, quality, ...common }
}

export const downloadRoutes = new Elysia({ prefix: '/download' })
  .get(
    '/movie/:id',
    async ({ params, set }) => {
      const result = await resolveStream('movie', Number(params.id))
      if (!result) { set.status = 404; return { error: 'No stream' } }
      try {
        return await buildPayload(result)
      } catch (e) {
        set.status = 500
        return { error: (e as Error).message }
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  .get(
    '/tv/:id/:season/:episode',
    async ({ params, set }) => {
      const result = await resolveStream('tv', Number(params.id), Number(params.season), Number(params.episode))
      if (!result) { set.status = 404; return { error: 'No stream' } }
      try {
        return await buildPayload(result)
      } catch (e) {
        set.status = 500
        return { error: (e as Error).message }
      }
    },
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }) }
  )
