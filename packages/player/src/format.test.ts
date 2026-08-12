import { describe, expect, test } from 'bun:test'
import {
  stripEpisodeSuffix,
  episodeLabel,
  fmt,
  isSpanish,
  audioLangLabel,
  describeSource,
  resolvePlaybackUri,
} from './format'
import { makeResolveInfo } from '../test/setup'
import type { SourceOption } from '@bmo/core/stream'
import type { MediaMeta } from './types'

describe('stripEpisodeSuffix', () => {
  test('saca el sufijo de temporada/episodio', () => {
    expect(stripEpisodeSuffix('Breaking Bad · T3:E7')).toBe('Breaking Bad')
  })

  test('saca sufijos repetidos (título ya viciado)', () => {
    expect(stripEpisodeSuffix('Breaking Bad · T9:E2 · T9:E2')).toBe('Breaking Bad')
  })

  test('título sin sufijo queda igual', () => {
    expect(stripEpisodeSuffix('Interstellar')).toBe('Interstellar')
  })
})

describe('episodeLabel', () => {
  test('serie con temporada/episodio', () => {
    expect(episodeLabel(true, 3, 7)).toBe('T3 · E7')
  })

  test('serie sin temporada/episodio cae a defaults 1/1', () => {
    expect(episodeLabel(true)).toBe('T1 · E1')
  })

  test('película → undefined', () => {
    expect(episodeLabel(false, 1, 1)).toBeUndefined()
  })
})

describe('fmt', () => {
  test('segundos bajo un minuto', () => {
    expect(fmt(45)).toBe('0:45')
  })

  test('minutos:segundos', () => {
    expect(fmt(754)).toBe('12:34')
  })

  test('horas:minutos:segundos', () => {
    expect(fmt(3723)).toBe('1:02:03')
  })

  test('valores inválidos o negativos caen a 0', () => {
    expect(fmt(NaN)).toBe('0:00')
    expect(fmt(-5)).toBe('0:00')
    expect(fmt(Infinity)).toBe('0:00')
  })
})

describe('isSpanish', () => {
  test('detecta por código ISO', () => {
    expect(isSpanish({ language: 'es' })).toBe(true)
    expect(isSpanish({ language: 'spa' })).toBe(true)
    expect(isSpanish({ language: 'en' })).toBe(false)
  })

  test('respaldo por etiqueta legible cuando no hay código', () => {
    expect(isSpanish({ label: 'Español (Latinoamérica)' })).toBe(true)
    expect(isSpanish({ label: 'Castellano' })).toBe(true)
    expect(isSpanish({ label: 'English' })).toBe(false)
  })

  test('sin language ni label → false', () => {
    expect(isSpanish({})).toBe(false)
  })

  test('pistas de MKV rotuladas solo como latino, sin código de idioma', () => {
    // Cobertura que tenía el detector propio del teléfono y no podía perderse
    // al mover la selección de subtítulo a useSubtitlePrefs.
    expect(isSpanish({ label: 'MEX' })).toBe(true)
    expect(isSpanish({ label: 'Audio 419' })).toBe(true)
    expect(isSpanish({ label: 'Latinoamericano' })).toBe(true)
  })

  test('es-419 / es-MX entran por el código ISO', () => {
    expect(isSpanish({ language: 'es-419' })).toBe(true)
    expect(isSpanish({ language: 'es-MX' })).toBe(true)
  })
})

describe('audioLangLabel', () => {
  test('prioriza latino sobre el resto', () => {
    expect(audioLangLabel(['english', 'latino'])).toBe('Latino')
  })

  test('mapea idiomas conocidos', () => {
    expect(audioLangLabel(['english'])).toBe('Inglés')
    expect(audioLangLabel(['portuguese'])).toBe('Portugués')
  })

  test('sin idioma reconocido → null', () => {
    expect(audioLangLabel([])).toBeNull()
    expect(audioLangLabel(['klingon'])).toBeNull()
  })
})

function makeSource(overrides: Partial<SourceOption> = {}): SourceOption {
  return {
    i: 0,
    label: 'mock',
    resolution: 1080,
    codec: 'h264',
    hdr: 'none',
    sizeGB: 4.2,
    cached: true,
    langs: [],
    ...overrides,
  }
}

describe('describeSource', () => {
  test('resolución + tamaño', () => {
    expect(describeSource(makeSource({ codec: null }))).toBe('1080p  ·  4.2 GB')
  })

  test('4K se etiqueta explícitamente', () => {
    expect(describeSource(makeSource({ resolution: 2160 }))).toContain('4K')
  })

  test('sin resolución', () => {
    expect(describeSource(makeSource({ resolution: null }))).toContain('Calidad desconocida')
  })

  test('HDR y Dolby Vision', () => {
    expect(describeSource(makeSource({ hdr: 'hdr10' }))).toContain('HDR')
    expect(describeSource(makeSource({ hdr: 'dv' }))).toContain('Dolby Vision')
  })

  test('codec HEVC se muestra en mayúsculas propias', () => {
    expect(describeSource(makeSource({ codec: 'hevc' }))).toContain('HEVC')
  })

  test('tamaños chicos se muestran en MB', () => {
    expect(describeSource(makeSource({ sizeGB: 0.5 }))).toContain('512 MB')
  })

  test('sin tamaño no agrega el segmento', () => {
    expect(describeSource(makeSource({ sizeGB: null, codec: null }))).toBe('1080p')
  })
})

const meta: MediaMeta = {
  id: 603,
  media_type: 'movie',
  title: 'The Matrix',
  poster_path: null,
  backdrop_path: null,
}

describe('resolvePlaybackUri', () => {
  test('fuente tipo file → usa streamUrl directo, sin pasar por el proxy', () => {
    const info = makeResolveInfo({ type: 'file', streamUrl: 'https://cdn.test/direct.mp4' })
    expect(resolvePlaybackUri(info, meta, 'latino', [])).toBe('https://cdn.test/direct.mp4')
  })

  test('fuente hls de película → master proxeado por id/lang/exclude', () => {
    const info = makeResolveInfo({ type: 'hls' })
    const uri = resolvePlaybackUri(info, meta, 'latino', ['realdebrid'])
    expect(uri).toContain('type=movie')
    expect(uri).toContain('id=603')
    expect(uri).toContain('lang=latino')
    expect(uri).toContain('exclude=realdebrid')
  })

  test('fuente hls de serie → master proxeado por temporada/episodio', () => {
    const info = makeResolveInfo({ type: 'hls' })
    const tvMeta: MediaMeta = {
      id: 1399,
      media_type: 'tv',
      title: 'GoT',
      poster_path: null,
      backdrop_path: null,
      season: 3,
      episode: 7,
    }
    const uri = resolvePlaybackUri(info, tvMeta, 'original', [])
    expect(uri).toContain('type=tv')
    expect(uri).toContain('season=3')
    expect(uri).toContain('episode=7')
  })
})
