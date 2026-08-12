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

  test('lee el año aunque le siga una coma dentro del corchete', () => {
    // Caso real de MediaFusion: sin esto el año quedaba en null, rejectionOf no
    // podía marcar wrong-year y este Superman del 78 competía por el de 2025.
    expect(parseYear('Superman [1978, BDRemux 1080p] MVO Original Eng')).toBe(1978)
  })

  test('el Superman del 78 se rechaza para la peli de 2025', () => {
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    expect(rejectionOf(parse('Superman [1978, BDRemux 1080p] MVO Original Eng'), ref)).toBe('wrong-year')
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
    // MediaFusion / Comet: rayo suelto sin corchetes = cacheado.
    ['MediaFusion ⚡️\n1080p', true],
    ['⚡ MediaFusion | RD', true],
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

  test.each([
    'Movie.Audio.Latino.1080p.mkv', 'Movie.Doblada.1080p.mkv', 'Movie.Doblaje.1080p.mkv',
    'Movie.es-419.1080p.mkv', 'Movie.LatAm.1080p.mkv', 'Movie 🇨🇱 1080p.mkv', 'Movie 🇵🇪 1080p.mkv',
  ])('%s marca latino (patrones ampliados)', (name) => {
    expect(parseLangs(name).has('latino')).toBe(true)
  })

  test('"Español" a secas = spanish ambiguo, NO latino ni castellano', () => {
    const l = parseLangs('Movie.Español.1080p.mkv')
    expect(l.has('spanish')).toBe(true)
    expect(l.has('latino')).toBe(false)
    expect(l.has('castellano')).toBe(false)
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

describe('rejectionOf — hardware flojo (hwTier low: Fire TV Stick)', () => {
  test('4K se descarta en low, pero NO en high', () => {
    const p = parse('Movie.2020.2160p.BluRay.x264.mkv')
    expect(rejectionOf(p, movieRef({ year: 2020 }), 'low')).toBe('too-heavy')
    expect(rejectionOf(p, movieRef({ year: 2020 }), 'high')).toBeNull()
  })

  test('HEVC 10-bit se descarta en low, pero NO en high', () => {
    const p = parse('Movie.2020.1080p.BluRay.x265.10bit.mkv')
    expect(rejectionOf(p, movieRef({ year: 2020 }), 'low')).toBe('too-heavy')
    expect(rejectionOf(p, movieRef({ year: 2020 }), 'high')).toBeNull()
  })

  test('1080p H.264 pasa en low (lo que el Stick decodifica por hardware)', () => {
    expect(rejectionOf(parse('Movie.2020.1080p.BluRay.x264.mkv'), movieRef({ year: 2020 }), 'low')).toBeNull()
  })

  test('rankCandidates(low) filtra 4K y 10-bit, deja el 1080p H.264', () => {
    const r = rankCandidates([
      stream('Movie.2020.2160p.x265.10bit.mkv'),
      stream('Movie.2020.1080p.x265.10bit.mkv'),
      stream('Movie.2020.1080p.x264.mkv'),
    ], movieRef({ year: 2020 }), 'low')
    expect(r.ranked).toHaveLength(1)
    expect(r.ranked[0].parsed.resolution).toBe(1080)
    expect(r.ranked[0].parsed.codec).toBe('h264')
    expect(r.rejected.filter((x) => x.reason === 'too-heavy')).toHaveLength(2)
  })
})

describe('procedencia del release', () => {
  test('un PRE-HD "1080p" pierde contra un BluRay 1080p', () => {
    // Caso real: en Superman (2025) ganaba este rip pre-estreno de Tamil,
    // porque tenía 1080p y buen bitrate y nada miraba de dónde salía.
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    const preHd = parse('www.1TamilMV.onl - Superman (2025) HQ PRE-HD - 1080p - x264 - [Tam].mkv')
    const bluray = parse('Superman.2025.1080p.BluRay.x264-GROUP.mkv')
    expect(preHd.releaseKind).toBe('cam')
    expect(scoreStream(bluray, ref).score)
      .toBeGreaterThan(scoreStream(preHd, ref).score)
  })

  test.each(['M.2020.HDCAM.1080p.mkv', 'M.2020.TELESYNC.720p.mkv', 'M.2020.PRE-HD.1080p.mkv'])(
    '%s se marca como cam', (name) => {
      expect(parse(name).releaseKind).toBe('cam')
    })

  test('no confunde DTS ni la extensión .ts con telesync', () => {
    expect(parse('M.2020.1080p.BluRay.DTS-HD.MA.x264.mkv').releaseKind).toBe('bluray')
    expect(parse('M.2020.1080p.ts').releaseKind).toBeNull()
  })

  test('un "TS" suelto entre puntos SÍ es telesync', () => {
    // Caso real: este rip rankeaba tercero en Superman (2025) con score 178
    // porque nada lo marcaba como grabación de sala.
    const p = parse('Superman.2025.1080p.TS.READNFO.x264.AC3-AOC.mkv')
    expect(p.releaseKind).toBe('cam')
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    expect(scoreStream(parse('Superman.2025.1080p.BluRay.x264-GROUP.mkv'), ref).score)
      .toBeGreaterThan(scoreStream(p, ref).score)
  })

  test('BluRay y WEB-DL no se penalizan', () => {
    const ref = movieRef({ year: 2020 })
    expect(scoreStream(parse('M.2020.1080p.BluRay.x264.mkv'), ref).parts.release).toBe(0)
    expect(scoreStream(parse('M.2020.1080p.WEB-DL.x264.mkv'), ref).parts.release).toBe(0)
  })
})

describe('not-video usa lista negra, no blanca', () => {
  test('rechaza lo que positivamente NO es video', () => {
    expect(rejectionOf(parse('Movie.1080p.rar'), movieRef())).toBe('not-video')
    expect(rejectionOf(parse('Movie.1080p.iso'), movieRef())).toBe('not-video')
  })

  test('REGRESIÓN: sin extensión legible NO se rechaza', () => {
    // Torrentio a veces no manda behaviorHints.filename y la primera línea de
    // `title` es un nombre de display sin extensión. Con lista blanca se caía
    // ~10% de candidatos por título, todos perfectamente válidos.
    const p = parse('Fight Club 1999 1080p 10th Ann Edt BluRay DTS x264 D-Z0N3')
    expect(rejectionOf(p, movieRef())).toBeNull()
  })

  test('.ts y .avi se aceptan (VLCKit los reproduce)', () => {
    expect(rejectionOf(parse('Movie.1999.1080p.ts'), movieRef())).toBeNull()
    expect(rejectionOf(parse('Movie.1999.1080p.avi'), movieRef())).toBeNull()
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
    const a = scoreStream(p, movieRef({ year: 2020, runtimeMin: 90 }))
    const b = scoreStream(p, movieRef({ year: 2020, runtimeMin: 180 }))
    expect(a.parts.bitrate).toBeLessThanOrEqual(b.parts.bitrate)
  })

  test('"BDRemux" pegado cuenta como remux y pierde contra un WEB-DL', () => {
    // Caso real: este era el ganador de Superman (2025) — un remux ucraniano.
    // \bremux\b no lo veía, así que esquivaba la penalización de -40 entera.
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    const remux = parse('Superman (2025) BDRemux 1080p 2xUkr Eng [Hurtom].mkv')
    expect(remux.isRemux).toBe(true)
    expect(scoreStream(parse('Superman.2025.1080p.WEB-DL.x264-GROUP.mkv 💾 3.4 GB'), ref).score)
      .toBeGreaterThan(scoreStream(remux, ref).score)
  })

  test('tamaño ilegible penaliza: no puede empatarle a un archivo medido y liviano', () => {
    // Los candidatos de MediaFusion no publican GB en el texto. Con bitrate 0
    // le ganaban a un WEB-DL 1080p honesto solo por no ser medibles.
    const ref = movieRef({ year: 2020, runtimeMin: 120 })
    const sinPeso = scoreStream(parse('M.2020.1080p.x264.mkv'), ref)
    const medido = scoreStream(parse('M.2020.1080p.x264.mkv 💾 3.5 GB'), ref)
    expect(sinPeso.parts.bitrate).toBeLessThan(0)
    expect(medido.score).toBeGreaterThan(sinPeso.score)
  })

  test('DV penaliza más que HDR10, y ambos penalizan', () => {
    const dv = scoreStream(parse('M.2020.1080p.DV.x264.mkv'), movieRef({ year: 2020 }))
    const hdr = scoreStream(parse('M.2020.1080p.HDR10.x264.mkv'), movieRef({ year: 2020 }))
    expect(dv.parts.hdr).toBeLessThan(hdr.parts.hdr)
    expect(hdr.parts.hdr).toBeLessThan(0)
  })

  test('pidiendo audio original, un release SIN el idioma original se penaliza', () => {
    const soloIta = scoreStream(parse('M.2020.1080p.ITA.x264.mkv'),
      movieRef({ year: 2020, originalLanguage: 'en' }))
    expect(soloIta.parts.lang).toBeLessThan(0)
  })

  test('un dual iTA+EnG NO se penaliza por idioma: sí trae el original', () => {
    // El archivo real de Superman dice "iTA EnG" — tiene inglés, así que
    // castigarlo por idioma sería incorrecto. Lo que lo hunde es 4K+DV+HEVC.
    const s = scoreStream(parse(FILE.supermanIta), movieRef({
      title: 'Superman', originalTitle: 'Superman', year: 2025, originalLanguage: 'en',
    }))
    expect(s.parts.lang).toBe(0)
    expect(s.parts.hdr).toBeLessThan(0)
    expect(s.parts.decode).toBeLessThan(0)
  })

  test('el ganador real de Superman pierde contra un 1080p x264 sobrio', () => {
    const ref = movieRef({ title: 'Superman', originalTitle: 'Superman', year: 2025, runtimeMin: 130 })
    const actual = scoreStream(parse(FILE.supermanIta), ref)
    const sane = scoreStream(parse('Superman.2025.1080p.BluRay.x264.mkv'), ref)
    expect(sane.score).toBeGreaterThan(actual.score)
  })

  // El ranking NO premia el español. Se busca la fuente que arranque más rápido
  // con la mejor calidad; el idioma se resuelve después, con la pista de audio
  // embebida y los subtítulos. Estos tests fijan esa decisión para que no se
  // reintroduzca un sesgo por doblaje sin querer.
  test('un release latino NO recibe bonus por serlo', () => {
    const lat = scoreStream(parse('M.2020.1080p.Dual.Lat.Eng.x264.mkv'), movieRef({ year: 2020 }))
    const eng = scoreStream(parse('M.2020.1080p.English.x264.mkv'), movieRef({ year: 2020 }))
    expect(lat.parts.lang).toBe(0)
    expect(eng.parts.lang).toBe(0)
  })

  test('entre dos cacheados, gana la calidad y no el idioma', () => {
    const latino480 = scoreStream(parse('M.2020.480p.Latino.x264.mkv'), movieRef({ year: 2020 }))
    const orig1080 = scoreStream(parse('M.2020.1080p.English.x264.mkv'), movieRef({ year: 2020 }))
    expect(orig1080.score).toBeGreaterThan(latino480.score)
  })

  test('un dual-audio conserva el original y no se castiga', () => {
    const dual = scoreStream(parse('M.2020.1080p.Dual.Lat.Eng.x264.mkv'), movieRef({ year: 2020 }))
    expect(dual.parts.lang).toBe(0)
  })

  // El castigo que SÍ queda: un doblaje que reemplaza al idioma original es peor
  // material de partida, sea al italiano o al español. No es preferencia de
  // idioma, es calidad de la fuente.
  test('un doblaje que pisa el idioma original se castiga, sea cual sea', () => {
    const soloEs = scoreStream(parse('M.2020.1080p.Español.x264.mkv'), movieRef({ year: 2020 }))
    const soloIta = scoreStream(parse('M.2020.1080p.ITA.x264.mkv'), movieRef({ year: 2020 }))
    expect(soloEs.parts.lang).toBeLessThan(0)
    expect(soloIta.parts.lang).toBe(soloEs.parts.lang)
  })

  test('cacheado suma; no cacheado no', () => {
    const cached = scoreStream(parse(FILE.inception1080, { name: '[RD+] Torrentio' }), movieRef({ year: 2010 }))
    const not = scoreStream(parse(FILE.inception1080, { name: '[RD download] Torrentio' }), movieRef({ year: 2010 }))
    expect(cached.parts.cached).toBeGreaterThan(not.parts.cached)
  })
})

describe('rankCandidates — integración', () => {
  test('con un 1080p disponible, el AV1 4K ya no gana', () => {
    const r = rankCandidates(
      [stream(FILE.inceptionAv1), stream(FILE.inception1080)],
      movieRef({ title: 'Inception', originalTitle: 'Inception', year: 2010, runtimeMin: 148 }))
    expect(r.ranked[0].parsed.filename).toBe(FILE.inception1080)
    expect(r.rejected.map((x) => x.reason)).toContain('av1')
  })

  test('el upscale falso pierde contra un 1080p real, y la peli ajena se rechaza', () => {
    const r = rankCandidates(
      [stream(FILE.fightClubUpscale), stream(FILE.nirvanna), stream('Fight.Club.1999.1080p.BluRay.x264.mkv')],
      movieRef())
    expect(r.ranked[0].parsed.isUpscale).toBe(false)
    expect(r.rejected.some((x) => x.reason === 'wrong-year')).toBe(true)
  })

  test('si TODO es AV1, ranked queda vacío (callejón deliberado)', () => {
    // Devolver null hace que scrape() caiga a los scrapers, que es mejor que
    // entregar un archivo que no va a reproducir.
    const r = rankCandidates([stream(FILE.inceptionAv1)], movieRef({ year: 2010 }))
    expect(r.ranked).toHaveLength(0)
  })

  test('hasLatinoAlternative solo cuenta candidatos que sobrevivieron', () => {
    // Un latino en AV1 no es una alternativa real: ofrecerla sería prometerle
    // al usuario un cambio de audio que no va a reproducir.
    const r = rankCandidates(
      [stream('M.2020.2160p.AV1.Latino.mkv'), stream('M.2020.1080p.x264.mkv')],
      movieRef({ year: 2020 }))
    expect(r.hasLatinoAlternative).toBe(false)
  })

  test('hasLatinoAlternative cuenta el "Español" ambiguo, no solo el latino explícito', () => {
    const r = rankCandidates([stream('M.2020.1080p.Español.x264.mkv')], movieRef({ year: 2020 }))
    expect(r.hasLatinoAlternative).toBe(true)
  })
})

describe('selectRunnable — filtro de cacheados con degradación', () => {
  const mk = (name: string | undefined, file: string) => stream(file, { name })

  test('con señal sana, solo corren los cacheados', () => {
    const r = rankCandidates([
      mk('[RD+] Torrentio', 'A.2020.1080p.x264.mkv'),
      mk('[RD download] Torrentio', 'B.2020.1080p.x264.mkv'),
    ], movieRef({ year: 2020 }))
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
    ], movieRef({ year: 2020 }))
    expect(r.cacheSignal).toBe('absent')
    expect(selectRunnable(r)).toHaveLength(r.ranked.length)
  })

  test('sin cacheados pero con señal sana → vacío (cae a scrapers)', () => {
    const r = rankCandidates([
      mk('[RD download] Torrentio', 'A.2020.1080p.x264.mkv'),
      mk('[RD+] Torrentio', 'B.2020.2160p.AV1.mkv'), // el único cacheado es AV1 → rechazado antes
    ], movieRef({ year: 2020 }))
    expect(selectRunnable(r)).toHaveLength(0)
  })
})
