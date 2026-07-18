import { describe, expect, test } from 'bun:test'
import {
  parseStream, parseCacheState, cacheSignalHealth, parseYear, parseEpisodeTag,
  parseSize, parseLangs, rejectionOf, bitrateMbps, decodePenalty, scoreStream,
  rankCandidates, selectRunnable, titleOverlap,
  type MediaRef, type TorrentioStream, type ParsedStream,
} from './torrentio.parse'

// Fixtures reales: son los archivos que HOY gana el resolver en producción
// para estos títulos (verificado vía /resolve/debug/debrid). Cada uno
// representa un modo de fallo distinto.
const FILE = {
  inceptionAv1: 'Inception.2010.Bluray.2160p.AV1.HDR10.AC3.5.1-UH.mkv',
  fightClubUpscale: 'El club de la Lucha 4Kreescalado2160.atomixhq.one.mkv',
  supermanIta: 'Superman (2025) 2160p H265 HDR10 DV iTA EnG AC3 Sub iTA EnG-MIRCrew.mkv',
  arcane4k: 'Arcane.S01E01.Welcome.to.the.Playground.2160p.10bit.HDR.BluRay.AAC5.1.HEVC-Vyndros.mkv',
  nirvanna: 'Nirvanna the Band the Show the Movie (2026) (1080p BluRay x265 r00t).mkv',
  inception1080: 'Inception.2010.1080p.BluRay.x264.DTS-FGT.mkv',
}

const movieRef = (over: Partial<MediaRef> = {}): MediaRef => ({
  type: 'movie', title: 'El club de la lucha', originalTitle: 'Fight Club',
  originalLanguage: 'en', year: 1999, runtimeMin: 139, ...over,
})
const tvRef = (over: Partial<MediaRef> = {}): MediaRef => ({
  type: 'tv', title: 'Arcane', originalTitle: 'Arcane', originalLanguage: 'en',
  year: 2021, runtimeMin: 44, season: 1, episode: 1, ...over,
})

const stream = (filename: string, over: Partial<TorrentioStream> = {}): TorrentioStream => ({
  url: 'https://torrentio.strem.fun/realdebrid/x/0', title: filename,
  behaviorHints: { filename }, ...over,
})
const parse = (filename: string, over: Partial<TorrentioStream> = {}) => parseStream(stream(filename, over))

describe('parseStream', () => {
  test('detecta AV1 en el ganador actual de Inception', () => {
    const p = parse(FILE.inceptionAv1)
    expect(p.codec).toBe('av1')
    expect(p.resolution).toBe(2160)
    expect(p.hdr).toBe('hdr10')
    expect(p.year).toBe(2010)
  })

  test('Dolby Vision gana sobre HDR10 cuando el nombre trae ambos', () => {
    const p = parse(FILE.supermanIta)
    expect(p.hdr).toBe('dv')
    expect(p.codec).toBe('hevc')
    expect(p.year).toBe(2025)
    expect([...p.langs]).toContain('italian')
    expect([...p.langs]).toContain('english')
  })

  test('detecta 10-bit y HEVC en Arcane', () => {
    const p = parse(FILE.arcane4k)
    expect(p.bitDepth).toBe(10)
    expect(p.codec).toBe('hevc')
    expect(p.season).toBe(1)
    expect(p.episode).toBe(1)
  })

  test('detecta el 4K falso por upscale, que además no trae año', () => {
    const p = parse(FILE.fightClubUpscale)
    expect(p.isUpscale).toBe(true)
    expect(p.resolution).toBe(2160)
    expect(p.year).toBeNull()
  })

  test('usa la primera línea de title cuando falta behaviorHints.filename', () => {
    // Torrentio lo omite en algunos torrents de archivo único; sin este
    // fallback el candidato se descartaba en silencio por "not-video".
    const p = parseStream({ url: 'x', title: `${FILE.inception1080}\n👤 40 💾 2.1 GB` })
    expect(p.filename).toBe(FILE.inception1080)
    expect(rejectionOf(p, movieRef({ year: 2010 }))).toBeNull()
  })
})

describe('parseYear — títulos que parecen años', () => {
  test.each([
    ['Blade.Runner.2049.2017.2160p.mkv', 2017],
    ['1917.2019.1080p.BluRay.x264.mkv', 2019],
    ['2012.2009.BluRay.1080p.mkv', 2009],
    ['Dune.Part.Two.2024.1080p.x264.mkv', 2024],
    ['Movie (1999) 1080p.mkv', 1999],
  ])('%s → %i', (name, expected) => {
    expect(parseYear(name)).toBe(expected)
  })

  test('sin año parseable devuelve null (no adivina)', () => {
    expect(parseYear(FILE.fightClubUpscale)).toBeNull()
  })

  test('descarta años futuros implausibles', () => {
    expect(parseYear('Some.Movie.9999.1080p.mkv')).toBeNull()
  })
})

describe('parseEpisodeTag', () => {
  test('SxxEyy explícito', () => {
    expect(parseEpisodeTag('Arcane.S01E01.1080p.mkv')).toEqual({ season: 1, episode: 1, isSeasonPack: false })
  })
  test('formato 1x01', () => {
    expect(parseEpisodeTag('Arcane.1x01.1080p.mkv')).toEqual({ season: 1, episode: 1, isSeasonPack: false })
  })
  test('season pack: episodio null', () => {
    expect(parseEpisodeTag('Breaking.Bad.S05.COMPLETE.1080p.x264.mkv'))
      .toEqual({ season: 5, episode: null, isSeasonPack: true })
  })
  test('"Season 2" en palabras', () => {
    expect(parseEpisodeTag('Show.Season.2.Complete.mkv'))
      .toEqual({ season: 2, episode: null, isSeasonPack: true })
  })
})

describe('parseSize', () => {
  test('GB', () => expect(parseSize('👤 45 💾 1.4 GB ⚙️ TPB')).toBeCloseTo(1.4))
  test('MB (antes no matcheaba)', () => expect(parseSize('👤 3 💾 850 MB ⚙️ RARBG')).toBeCloseTo(0.83, 1))
  test('sin marcador → null', () => expect(parseSize('Movie.1080p.mkv')).toBeNull())
})

describe('parseCacheState — tolerante a deriva de formato', () => {
  test.each([
    ['[RD+] Torrentio\n1080p', true],
    ['[RD download] Torrentio\n1080p', false],
    ['[AD+] Torrentio', true],
    ['[RD⚡] Torrentio', true],
  ])('%s → %p', (name, expected) => {
    expect(parseCacheState(name)).toBe(expected as any)
  })

  test('sin marcador → null, NUNCA false', () => {
    // Esta distinción es la que evita que un cambio de formato en Torrentio
    // deje a Real-Debrid sin candidatos.
    expect(parseCacheState('Torrentio\n4k')).toBeNull()
    expect(parseCacheState(undefined)).toBeNull()
  })

  test('"[RD]" pelado es ambiguo → null', () => {
    expect(parseCacheState('[RD] Torrentio')).toBeNull()
  })
})

describe('cacheSignalHealth', () => {
  const withCache = (states: (boolean | null)[]) =>
    states.map((c) => ({ cached: c } as ParsedStream))

  test('mezcla → ok', () => expect(cacheSignalHealth(withCache([true, false, true]))).toBe('ok'))
  test('ninguno legible → absent', () => expect(cacheSignalHealth(withCache([null, null]))).toBe('absent'))
  test('todos iguales → uniform (no discrimina)', () => {
    expect(cacheSignalHealth(withCache([true, true]))).toBe('uniform')
  })
})

describe('parseLangs', () => {
  test.each(['Movie.Dual.Lat.1080p.mkv', 'Movie [LAT] 1080p.mkv', 'Movie.ESP-LAT.1080p.mkv',
    'Movie.spa-lat.1080p.mkv', 'Movie.Latino.1080p.mkv', 'Movie 🇲🇽 1080p.mkv',
  ])('%s marca latino', (name) => {
    expect(parseLangs(name).has('latino')).toBe(true)
  })

  test.each(['Movie.TRANSLATED.1080p.mkv', 'Platinum.Collection.1080p.mkv'])(
    '%s NO marca latino (falso positivo de substring)', (name) => {
      expect(parseLangs(name).has('latino')).toBe(false)
    })

  test('castellano no es latino — son doblajes distintos', () => {
    const l = parseLangs('Movie.Castellano.1080p.mkv')
    expect(l.has('castellano')).toBe(true)
    expect(l.has('latino')).toBe(false)
  })
})

describe('rejectionOf — rechazos duros', () => {
  test('AV1 se rechaza: el iPhone no lo decodifica', () => {
    expect(rejectionOf(parse(FILE.inceptionAv1), movieRef({ year: 2010 }))).toBe('av1')
  })

  test('película equivocada se rechaza por año', () => {
    // El caso real: buscando Fight Club (1999) Torrentio devolvía esto.
    expect(rejectionOf(parse(FILE.nirvanna), movieRef())).toBe('wrong-year')
  })

  test('REGRESIÓN: un release sin año NO se rechaza', () => {
    // "El club de la Lucha 4Kreescalado" no trae año; rechazarlo por eso
    // tiraría releases legítimos en español.
    expect(rejectionOf(parse(FILE.fightClubUpscale), movieRef())).toBeNull()
  })

  test('REGRESIÓN: en series no se valida el año', () => {
    // El año del archivo es el de emisión del episodio (2012), el de MediaRef
    // sería el de inicio de la serie (2008). Validar año rompería toda
    // temporada tardía de cualquier serie larga.
    const p = parse('Breaking.Bad.S05E14.2012.1080p.x264.mkv')
    const ref = tvRef({ title: 'Breaking Bad', year: 2008, season: 5, episode: 14 })
    expect(rejectionOf(p, ref)).toBeNull()
  })

  test('REGRESIÓN: los season packs no se rechazan por episodio', () => {
    // Suelen ser las fuentes mejor sembradas y más veces cacheadas; el
    // episodio lo resuelve Torrentio vía fileIdx.
    const p = parse('Breaking.Bad.S05.COMPLETE.1080p.BluRay.x264.mkv')
    const ref = tvRef({ title: 'Breaking Bad', year: 2012, season: 5, episode: 3 })
    expect(rejectionOf(p, ref)).toBeNull()
  })

  test('episodio explícito equivocado sí se rechaza', () => {
    expect(rejectionOf(parse(FILE.arcane4k), tvRef({ episode: 2 }))).toBe('wrong-episode')
  })

  test('temporada equivocada se rechaza', () => {
    expect(rejectionOf(parse(FILE.arcane4k), tvRef({ season: 2, episode: 1 }))).toBe('wrong-season')
  })

  test('sin url → no-url; no-video → not-video', () => {
    expect(rejectionOf(parse(FILE.inception1080, { url: undefined }), movieRef({ year: 2010 }))).toBe('no-url')
    expect(rejectionOf(parse('Movie.1080p.rar'), movieRef())).toBe('not-video')
  })
})

describe('titleOverlap', () => {
  test('reconoce el título traducido y el original', () => {
    expect(titleOverlap(FILE.fightClubUpscale, movieRef())).toBeGreaterThan(0)
    expect(titleOverlap('Fight.Club.1999.1080p.mkv', movieRef())).toBe(1)
  })
  test('una película ajena no solapa', () => {
    expect(titleOverlap(FILE.nirvanna, movieRef())).toBe(0)
  })
})

describe('decodePenalty — interacción, no suma independiente', () => {
  test('1080p HEVC 10-bit va bien; 2160p HEVC 10-bit no', () => {
    // Es el punto del término de interacción: el problema no es el códec ni la
    // resolución por separado, es el producto.
    expect(decodePenalty(1080, 'hevc', 10)).toBeGreaterThan(decodePenalty(2160, 'hevc', 10))
    expect(decodePenalty(1080, 'hevc', 10)).toBeGreaterThan(-10)
  })
  test('1080p x264 no se penaliza', () => {
    expect(decodePenalty(1080, 'h264', 8)).toBe(0)
  })
})

describe('bitrateMbps', () => {
  test('mismo tamaño, distinta duración → distinto bitrate', () => {
    const short = bitrateMbps(20, 90)!
    const long = bitrateMbps(20, 180)!
    expect(short).toBeGreaterThan(long)
  })
  test('sin runtime → null', () => expect(bitrateMbps(20, null)).toBeNull())
})

describe('scoreStream — desglose por término', () => {
  test('el bitrate castiga más 20GB/90min que 20GB/180min', () => {
    const p = parse('Movie.2020.1080p.x264.mkv 💾 20 GB')
    const a = scoreStream(p, movieRef({ year: 2020, runtimeMin: 90 }), 'original')
    const b = scoreStream(p, movieRef({ year: 2020, runtimeMin: 180 }), 'original')
    expect(a.parts.bitrate).toBeLessThanOrEqual(b.parts.bitrate)
  })

  test('DV penaliza más que HDR10, y ambos penalizan', () => {
    const dv = scoreStream(parse('M.2020.1080p.DV.x264.mkv'), movieRef({ year: 2020 }), 'original')
    const hdr = scoreStream(parse('M.2020.1080p.HDR10.x264.mkv'), movieRef({ year: 2020 }), 'original')
    expect(dv.parts.hdr).toBeLessThan(hdr.parts.hdr)
    expect(hdr.parts.hdr).toBeLessThan(0)
  })

  test('pidiendo audio original, un release SIN el idioma original se penaliza', () => {
    const soloIta = scoreStream(parse('M.2020.1080p.ITA.x264.mkv'),
      movieRef({ year: 2020, originalLanguage: 'en' }), 'original')
    expect(soloIta.parts.lang).toBeLessThan(0)
  })

  test('un dual iTA+EnG NO se penaliza por idioma: sí trae el original', () => {
    // El archivo real de Superman dice "iTA EnG" — tiene inglés, así que
    // castigarlo por idioma sería incorrecto. Lo que lo hunde es 4K+DV+HEVC.
    const s = scoreStream(parse(FILE.supermanIta), movieRef({
      title: 'Superman', originalTitle: 'Superman', year: 2025, originalLanguage: 'en',
    }), 'original')
    expect(s.parts.lang).toBe(0)
    expect(s.parts.hdr).toBeLessThan(0)
    expect(s.parts.decode).toBeLessThan(0)
  })

  test('el ganador real de Superman pierde contra un 1080p x264 sobrio', () => {
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    const actual = scoreStream(parse(FILE.supermanIta), ref, 'original')
    const sane = scoreStream(parse('Superman.2025.1080p.BluRay.x264.mkv'), ref, 'original')
    expect(sane.score).toBeGreaterThan(actual.score)
  })

  test('pidiendo latino, un dual-audio puntúa a la par de un latino-solo', () => {
    const dual = scoreStream(parse('M.2020.1080p.Dual.Lat.Eng.x264.mkv'), movieRef({ year: 2020 }), 'latino')
    const only = scoreStream(parse('M.2020.1080p.Latino.x264.mkv'), movieRef({ year: 2020 }), 'latino')
    expect(dual.parts.lang).toBeGreaterThan(0)
    expect(Math.abs(dual.parts.lang - only.parts.lang)).toBeLessThanOrEqual(20)
  })

  test('cacheado suma; no cacheado no', () => {
    const cached = scoreStream(parse(FILE.inception1080, { name: '[RD+] Torrentio' }), movieRef({ year: 2010 }), 'original')
    const not = scoreStream(parse(FILE.inception1080, { name: '[RD download] Torrentio' }), movieRef({ year: 2010 }), 'original')
    expect(cached.parts.cached).toBeGreaterThan(not.parts.cached)
  })
})

describe('rankCandidates — integración', () => {
  test('con un 1080p disponible, el AV1 4K ya no gana', () => {
    const r = rankCandidates(
      [stream(FILE.inceptionAv1), stream(FILE.inception1080)],
      movieRef({ title: 'Inception', originalTitle: 'Inception', year: 2010, runtimeMin: 148 }),
      'original'
    )
    expect(r.ranked[0].parsed.filename).toBe(FILE.inception1080)
    expect(r.rejected.map((x) => x.reason)).toContain('av1')
  })

  test('el upscale falso pierde contra un 1080p real, y la peli ajena se rechaza', () => {
    const r = rankCandidates(
      [stream(FILE.fightClubUpscale), stream(FILE.nirvanna), stream('Fight.Club.1999.1080p.BluRay.x264.mkv')],
      movieRef(), 'original'
    )
    expect(r.ranked[0].parsed.isUpscale).toBe(false)
    expect(r.rejected.some((x) => x.reason === 'wrong-year')).toBe(true)
  })

  test('si TODO es AV1, ranked queda vacío (callejón deliberado)', () => {
    // Devolver null hace que scrape() caiga a los scrapers, que es mejor que
    // entregar un archivo que no va a reproducir.
    const r = rankCandidates([stream(FILE.inceptionAv1)], movieRef({ year: 2010 }), 'original')
    expect(r.ranked).toHaveLength(0)
  })

  test('hasLatinoAlternative solo cuenta candidatos que sobrevivieron', () => {
    // Un latino en AV1 no es una alternativa real: ofrecerla sería prometerle
    // al usuario un cambio de audio que no va a reproducir.
    const r = rankCandidates(
      [stream('M.2020.2160p.AV1.Latino.mkv'), stream('M.2020.1080p.x264.mkv')],
      movieRef({ year: 2020 }), 'original'
    )
    expect(r.hasLatinoAlternative).toBe(false)
  })
})

describe('selectRunnable — filtro de cacheados con degradación', () => {
  const mk = (name: string | undefined, file: string) => stream(file, { name })

  test('con señal sana, solo corren los cacheados', () => {
    const r = rankCandidates([
      mk('[RD+] Torrentio', 'A.2020.1080p.x264.mkv'),
      mk('[RD download] Torrentio', 'B.2020.1080p.x264.mkv'),
    ], movieRef({ year: 2020 }), 'original')
    expect(r.cacheSignal).toBe('ok')
    const runnable = selectRunnable(r)
    expect(runnable).toHaveLength(1)
    expect(runnable[0].parsed.cached).toBe(true)
  })

  test('GARANTÍA: si no se lee el marcador, sobrevive la lista completa', () => {
    // Sin esto, un cambio de formato en Torrentio dejaría 0 candidatos y
    // Real-Debrid quedaría inutilizado en silencio.
    const r = rankCandidates([
      mk(undefined, 'A.2020.1080p.x264.mkv'),
      mk(undefined, 'B.2020.1080p.x264.mkv'),
    ], movieRef({ year: 2020 }), 'original')
    expect(r.cacheSignal).toBe('absent')
    expect(selectRunnable(r)).toHaveLength(r.ranked.length)
  })

  test('sin cacheados pero con señal sana → vacío (cae a scrapers)', () => {
    const r = rankCandidates([
      mk('[RD download] Torrentio', 'A.2020.1080p.x264.mkv'),
      mk('[RD+] Torrentio', 'B.2020.2160p.AV1.mkv'), // el único cacheado es AV1 → rechazado antes
    ], movieRef({ year: 2020 }), 'original')
    expect(selectRunnable(r)).toHaveLength(0)
  })
})
