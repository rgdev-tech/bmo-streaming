import { describe, expect, test } from 'bun:test'
import {
  releaseGroup, originKind, editions, spanishFlavor,
  releaseAffinity, scoreCandidate, pickCaptions,
  type SubCandidate,
} from './subtitles'

// Fixtures reales: los archivos que HOY sirve Real-Debrid y los subtítulos que
// HOY devuelve Wyzie para esos títulos (verificado vía /resolve/debug/subs y
// /resolve/movie). Cada par es un desfase que el usuario ve en la pantalla.
const VIDEO = {
  fightClub: 'Fight.Club.1999.REMASTERED.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv',
  superman: 'Superman 2025 1080p 10bit BluRay 8CH X265 HEVC-PSA.mkv',
}
const SUB = {
  fightClubEuReKA: 'Fight.Club.1999.BluRay.1080p.DTS.x264.dxva-EuReKA.SPA.srt Español europeo.',
  fightClubRemux: 'Fight.Club.1999.REMASTERED.1080p.BluRay.x265-GalaxyRG265',
  supermanWebLatino: 'Superman.2025.iT.WEB.es-419 Superman.2025.iT.WEB.es-419.srt',
  supermanBluray: 'Superman.2025.1080p.BluRay.x265-PSA',
}

const cand = (over: Partial<SubCandidate> = {}): SubCandidate => ({
  lang: 'es', display: 'Spanish', type: 'srt', url: 'https://x/1',
  release: '', origin: '', downloadCount: 0, hearingImpaired: false, ai: false,
  ...over,
})

describe('releaseGroup', () => {
  test.each([
    ['Fight.Club.1999.BluRay.1080p.DTS.x264.dxva-EuReKA.SPA.srt', 'eureka'],
    ['Superman 2025 1080p 10bit BluRay 8CH X265 HEVC-PSA.mkv', 'psa'],
    ['Inception.2010.1080p.BluRay.x264.DTS-FGT.mkv', 'fgt'],
  ])('%s → %s', (name, expected) => {
    expect(releaseGroup(name)).toBe(expected)
  })

  test('sin guión final no inventa grupo', () => {
    expect(releaseGroup('Movie 2020 1080p BluRay.mkv')).toBeNull()
  })

  test('un sufijo numérico no es un grupo', () => {
    expect(releaseGroup('Movie.2020.1080p.DDP5.1')).toBeNull()
  })
})

describe('originKind', () => {
  test.each([
    ['Superman.2025.1080p.BluRay.x265-PSA', 'bluray'],
    ['Superman.2025.iT.WEB.es-419', 'web'],
    ['Show.S01E01.HDTV.x264', 'hdtv'],
  ] as const)('%s → %s', (name, expected) => {
    expect(originKind(name)).toBe(expected)
  })
})

describe('editions — cortes que cambian la duración', () => {
  test('detecta REMASTERED', () => {
    expect([...editions(VIDEO.fightClub)]).toContain('remastered')
  })
  test('un release sin corte especial no declara ninguno', () => {
    expect(editions('Movie.2020.1080p.BluRay.x264.mkv').size).toBe(0)
  })
})

describe('spanishFlavor', () => {
  test.each([
    ['Superman.2025.iT.WEB.es-419', 'latino'],
    ['Fight.Club.1999.BluRay-EuReKA Español europeo.', 'castellano'],
    ['Movie.2020.1080p.spanish.srt', null],
  ] as const)('%s → %s', (name, expected) => {
    expect(spanishFlavor(name)).toBe(expected)
  })
})

describe('releaseAffinity — el caso que el usuario ve descuadrado', () => {
  test('Fight Club: el subtítulo del MISMO remaster le gana al de otro release', () => {
    const bueno = releaseAffinity(SUB.fightClubRemux, VIDEO.fightClub)
    const malo = releaseAffinity(SUB.fightClubEuReKA, VIDEO.fightClub)
    expect(bueno).toBeGreaterThan(malo)
  })

  test('Fight Club: el mismatch de corte (REMASTERED) penaliza de verdad', () => {
    // No se arregla con offset: el corte remasterizado dura distinto.
    expect(releaseAffinity(SUB.fightClubEuReKA, VIDEO.fightClub)).toBeLessThan(0)
  })

  test('Superman: el subtítulo BluRay le gana al WEB aunque el WEB sea latino', () => {
    // La afinidad sola no mira idioma; eso entra recién en scoreCandidate.
    expect(releaseAffinity(SUB.supermanBluray, VIDEO.superman))
      .toBeGreaterThan(releaseAffinity(SUB.supermanWebLatino, VIDEO.superman))
  })

  test('sin nombre de archivo no hay señal: todo empata en 0', () => {
    expect(releaseAffinity(SUB.fightClubEuReKA, null)).toBe(0)
    expect(releaseAffinity(SUB.supermanWebLatino, null)).toBe(0)
  })
})

describe('scoreCandidate — preferencias sobre la afinidad', () => {
  test('a igual release, gana el latino sobre el castellano', () => {
    const latino = scoreCandidate(cand({ release: 'Movie.2020.1080p.BluRay-GRP es-419' }), null)
    const castellano = scoreCandidate(cand({ release: 'Movie.2020.1080p.BluRay-GRP castellano' }), null)
    expect(latino).toBeGreaterThan(castellano)
  })

  test('el release correcto le gana a un latino de otro release', () => {
    // Esta es la jerarquía que importa: sincronía primero, idioma después. Un
    // latino corrido es peor que un castellano que entra en tiempo.
    const correcto = scoreCandidate(
      cand({ release: SUB.supermanBluray }), VIDEO.superman)
    const latinoCorrido = scoreCandidate(
      cand({ release: SUB.supermanWebLatino }), VIDEO.superman)
    expect(correcto).toBeGreaterThan(latinoCorrido)
  })

  test('SDH y subtítulos de IA penalizan', () => {
    const base = scoreCandidate(cand({ release: 'M.2020.BluRay-GRP' }), null)
    expect(scoreCandidate(cand({ release: 'M.2020.BluRay-GRP', hearingImpaired: true }), null)).toBeLessThan(base)
    expect(scoreCandidate(cand({ release: 'M.2020.BluRay-GRP', ai: true }), null)).toBeLessThan(base)
  })

  test('la popularidad desempata pero no da vuelta un mismatch de release', () => {
    const popularCorrido = scoreCandidate(
      cand({ release: SUB.supermanWebLatino, downloadCount: 999_999 }), VIDEO.superman)
    const impopularCorrecto = scoreCandidate(
      cand({ release: SUB.supermanBluray, downloadCount: 1 }), VIDEO.superman)
    expect(impopularCorrecto).toBeGreaterThan(popularCorrido)
  })
})

describe('pickCaptions', () => {
  const candidatos: SubCandidate[] = [
    cand({ url: 'https://x/web', release: SUB.supermanWebLatino, downloadCount: 192_630 }),
    cand({ url: 'https://x/bluray', release: SUB.supermanBluray, downloadCount: 500 }),
    cand({ url: 'https://x/otro', release: 'Superman.2025.HDTV.x264-XYZ', downloadCount: 10 }),
    cand({ lang: 'en', url: 'https://x/en', display: 'English', release: SUB.supermanBluray }),
  ]

  test('el primero es el que empareja con el archivo, no el más bajado', () => {
    const [es] = pickCaptions(candidatos, VIDEO.superman).filter((c) => c.language === 'Spanish')
    expect(es.url).toBe('https://x/bluray')
    expect(es.altUrls).toContain('https://x/web')
  })

  test('un Caption por idioma, con el resto como respaldo', () => {
    const out = pickCaptions(candidatos, VIDEO.superman)
    expect(out.map((c) => c.language).sort()).toEqual(['English', 'Spanish'])
    expect(out.find((c) => c.language === 'Spanish')!.altUrls).toHaveLength(2)
  })

  test('perLang acota cuántas alternativas se mandan', () => {
    const es = pickCaptions(candidatos, VIDEO.superman, 2).find((c) => c.language === 'Spanish')!
    expect(es.altUrls).toHaveLength(1)
  })

  test('sin candidatos no devuelve nada', () => {
    expect(pickCaptions([], VIDEO.superman)).toEqual([])
  })

  test('descarta entradas sin url o sin idioma', () => {
    expect(pickCaptions([cand({ url: '' }), cand({ lang: '' })], null)).toEqual([])
  })
})
