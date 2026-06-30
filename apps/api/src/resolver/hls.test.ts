import { describe, expect, test } from 'bun:test'
import { langCode, srtToVtt, bandwidthOf, rewriteMaster, ensureBandwidth } from './hls'

describe('langCode', () => {
  test('mapea idiomas comunes a ISO', () => {
    expect(langCode('Spanish')).toBe('es')
    expect(langCode('Español (Latinoamérica)')).toBe('es')
    expect(langCode('English')).toBe('en')
    expect(langCode('Português')).toBe('pt')
    expect(langCode('French')).toBe('fr')
  })

  test('idioma desconocido → und', () => {
    expect(langCode('Klingon')).toBe('und')
  })
})

describe('srtToVtt', () => {
  test('convierte timestamps SRT (coma) a VTT (punto) y añade cabecera', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nHola\n'
    const vtt = srtToVtt(srt)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000')
    expect(vtt).not.toContain(',000')
  })
})

describe('bandwidthOf', () => {
  test('extrae el BANDWIDTH', () => {
    expect(bandwidthOf('#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080')).toBe(5000000)
  })
  test('sin BANDWIDTH → 0', () => {
    expect(bandwidthOf('#EXT-X-STREAM-INF:RESOLUTION=1920x1080')).toBe(0)
  })
})

describe('ensureBandwidth', () => {
  test('inyecta BANDWIDTH si falta (estimado desde RESOLUTION)', () => {
    const out = ensureBandwidth('#EXT-X-STREAM-INF:RESOLUTION=1920x1072')
    expect(out).toMatch(/^#EXT-X-STREAM-INF:BANDWIDTH=\d+,RESOLUTION=1920x1072$/)
    expect(bandwidthOf(out)).toBe(6_000_000)
  })
  test('respeta el BANDWIDTH existente', () => {
    const line = '#EXT-X-STREAM-INF:BANDWIDTH=467804,RESOLUTION=852x480'
    expect(ensureBandwidth(line)).toBe(line)
  })
  test('alturas recortadas (1072/714) caen en su tier real', () => {
    expect(bandwidthOf(ensureBandwidth('#EXT-X-STREAM-INF:RESOLUTION=1920x1072'))).toBe(6_000_000)
    expect(bandwidthOf(ensureBandwidth('#EXT-X-STREAM-INF:RESOLUTION=1280x714'))).toBe(3_000_000)
    expect(bandwidthOf(ensureBandwidth('#EXT-X-STREAM-INF:RESOLUTION=854x480'))).toBe(1_400_000)
  })
  test('sin RESOLUTION → default razonable', () => {
    expect(bandwidthOf(ensureBandwidth('#EXT-X-STREAM-INF:CODECS="avc1"'))).toBe(2_000_000)
  })
})

describe('rewriteMaster', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    'https://cdn/360.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
    'https://cdn/1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
    'https://cdn/720.m3u8',
  ].join('\n')

  test('reordena variantes por bitrate descendente (HD primero)', () => {
    const out = rewriteMaster(master, [])
    const lines = out.split('\n').filter((l) => l.endsWith('.m3u8'))
    expect(lines).toEqual([
      'https://cdn/1080.m3u8',
      'https://cdn/720.m3u8',
      'https://cdn/360.m3u8',
    ])
  })

  test('inyecta subtítulos y añade SUBTITLES a cada variante', () => {
    const sub = '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",URI="sub.m3u8"'
    const out = rewriteMaster(master, [sub])
    expect(out).toContain(sub)
    const infLines = out.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF'))
    expect(infLines.every((l) => l.includes('SUBTITLES="subs"'))).toBe(true)
  })

  test('playlist sin variantes se devuelve intacto si no hay subs', () => {
    const media = '#EXTM3U\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2.ts'
    expect(rewriteMaster(media, [])).toBe(media)
  })

  test('preserva la cabecera antes de las variantes', () => {
    const out = rewriteMaster(master, [])
    expect(out.startsWith('#EXTM3U')).toBe(true)
  })
})
