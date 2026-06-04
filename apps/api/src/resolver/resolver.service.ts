import { makeProviders, makeStandardFetcher, targets, type SourcererOutput } from '@movie-web/providers'
import { TTLCache } from './cache'

const STREAM_TTL = 4 * 60 * 60 * 1000

export type Caption = { language: string; url: string; type: string }

export type StreamResult = {
  url: string
  captions: Caption[]
  headers: Record<string, string>
  source: string
}

const cache = new TTLCache<StreamResult | null>(STREAM_TTL)

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.ANY,
})

async function trySource(
  sourceId: string,
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  try {
    const media = type === 'tv'
      ? { type: 'show' as const, tmdbId: String(tmdbId), season: { number: season ?? 1 }, episode: { number: episode ?? 1 }, title: '', releaseYear: 2000 }
      : { type: 'movie' as const, tmdbId: String(tmdbId), title: '', releaseYear: 2000 }

    const output: SourcererOutput = await providers.runSourceScraper({ sourceId, media })

    // Buscar el mejor stream HLS
    const streams = output.stream ?? []
    for (const stream of streams) {
      if (stream.type === 'hls' && stream.playlist) {
        const captions: Caption[] = (stream.captions ?? []).map((c: any) => ({
          language: c.language ?? c.langIso ?? 'und',
          url: c.url,
          type: c.type ?? 'vtt',
        }))
        console.error(`[${sourceId}] found HLS stream`)
        return {
          url: stream.playlist,
          captions,
          headers: stream.preferredHeaders ?? {},
          source: sourceId,
        }
      }
    }
    console.error(`[${sourceId}] no HLS stream in output`)
    return null
  } catch (e) {
    console.error(`[${sourceId}] error:`, (e as Error).message)
    return null
  }
}

async function scrape(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const sources = providers.listSources()
  const CONCURRENCY = 3
  let resolved = false
  let active = 0
  let index = 0

  return new Promise((resolve) => {
    function next() {
      if (resolved) return
      if (index >= sources.length && active === 0) {
        resolve(null)
        return
      }
      while (active < CONCURRENCY && index < sources.length) {
        const source = sources[index++]
        active++
        trySource(source.id, type, tmdbId, season, episode).then((result) => {
          active--
          if (!resolved && result) {
            resolved = true
            resolve(result)
          } else {
            next()
          }
        })
      }
    }
    next()
  })
}

export function resolveStream(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<StreamResult | null> {
  const key = type === 'tv' ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`
  return cache.resolve(key, () => scrape(type, tmdbId, season, episode))
}
