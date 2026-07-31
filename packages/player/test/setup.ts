import { mock } from 'bun:test'
import type { ResolveInfo } from '@bmo/core/stream'

// react-test-renderer necesita esto para saber que act(...) corre dentro de un
// entorno de test (si no, tira warnings aunque el resultado sea correcto).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// packages/player es headless: sus hooks importan @bmo/core, que a su vez
// importa AsyncStorage/expo-constants/supabase (solo existen dentro de una app
// RN real). Para testear la lógica en bun:test se reemplazan esos módulos por
// mocks controlables, cargados vía bunfig.toml [test].preload ANTES de que
// cualquier test importe el código bajo prueba.

mock.module('@bmo/core/stream', () => ({
  getAudioLang: mock(async () => 'latino'),
  setAudioLang: mock(() => {}),
  setHwTier: mock(() => {}),
  stream: {
    resolveMovie: mock(async () => makeResolveInfo()),
    resolveTv: mock(async () => makeResolveInfo()),
    sources: mock(async () => []),
    pickSource: mock(async () => makeResolveInfo()),
    masterMovie: mock(
      (id: string | number, lang = 'original', exclude: string[] = []) =>
        `https://api.test/stream/master.m3u8?type=movie&id=${id}&lang=${lang}${exclude.length ? `&exclude=${exclude.join(',')}` : ''}`
    ),
    masterTv: mock(
      (id: string | number, season: number, episode: number, lang = 'original', exclude: string[] = []) =>
        `https://api.test/stream/master.m3u8?type=tv&id=${id}&season=${season}&episode=${episode}&lang=${lang}${exclude.length ? `&exclude=${exclude.join(',')}` : ''}`
    ),
    prewarm: mock(() => {}),
  },
}))

mock.module('@bmo/core/library', () => ({
  getProgress: mock(async () => 0),
  saveProgress: mock(async () => {}),
  getContinueWatching: mock(async () => []),
}))

mock.module('@bmo/core/subtitleStyle', () => ({
  DEFAULT_SUBTITLE_STYLE: { size: 'medium', color: 'white', background: 'none' },
  getSubtitleStyle: mock(async () => ({ size: 'medium', color: 'white', background: 'none' })),
  setSubtitleStyle: mock(async () => {}),
  getSubtitleOffset: mock(async () => 0),
  setSubtitleOffset: mock(async () => {}),
}))

// Fixture default de ResolveInfo para los mocks de arriba y para los tests.
export function makeResolveInfo(overrides: Partial<ResolveInfo> = {}): ResolveInfo {
  return { ...baseResolveInfo(), ...overrides }
}

function baseResolveInfo(): ResolveInfo {
  return {
    streamUrl: 'https://cdn.test/movie.mp4',
    type: 'file',
    referer: 'https://cdn.test',
    source: 'mock-source',
    language: 'Español Latino',
    subtitles: [],
    hasLatinoAlternative: false,
  }
}
