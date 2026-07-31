import { describe, expect, test, beforeEach } from 'bun:test'
import { act } from 'react-test-renderer'
import { renderHook } from '../test/renderHook'
import { useSubtitlePrefs } from './useSubtitlePrefs'
import {
  getSubtitleStyle,
  setSubtitleStyle,
  getSubtitleOffset,
  setSubtitleOffset,
  DEFAULT_SUBTITLE_STYLE,
} from '@bmo/core/subtitleStyle'
import type { SrtCue } from '@bmo/core/srt'
import type { TrackLike } from './types'

const mockGetSubtitleStyle = getSubtitleStyle as ReturnType<typeof import('bun:test').mock>
const mockSetSubtitleStyle = setSubtitleStyle as ReturnType<typeof import('bun:test').mock>
const mockGetSubtitleOffset = getSubtitleOffset as ReturnType<typeof import('bun:test').mock>
const mockSetSubtitleOffset = setSubtitleOffset as ReturnType<typeof import('bun:test').mock>

beforeEach(() => {
  mockGetSubtitleStyle.mockClear().mockReset().mockResolvedValue(DEFAULT_SUBTITLE_STYLE)
  mockSetSubtitleStyle.mockClear().mockReset().mockResolvedValue(undefined)
  mockGetSubtitleOffset.mockClear().mockReset().mockResolvedValue(0)
  mockSetSubtitleOffset.mockClear().mockReset().mockResolvedValue(undefined)
})

type Props = { offsetKey: string; srtCues: SrtCue[]; subtitleTracks: TrackLike[] }
const baseProps: Props = { offsetKey: 'movie:603', srtCues: [], subtitleTracks: [] }

async function mount(props: Props = baseProps) {
  const helper = renderHook((p: Props) => useSubtitlePrefs(p), props)
  await act(async () => {})
  return helper
}

describe('useSubtitlePrefs — carga inicial', () => {
  test('carga estilo y offset persistidos por offsetKey', async () => {
    mockGetSubtitleOffset.mockResolvedValue(2.5)
    const { result } = await mount()
    expect(mockGetSubtitleOffset).toHaveBeenCalledWith('movie:603')
    expect(result.current.subOffset).toBe(2.5)
    expect(result.current.subStyle).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  test('sin cues ni pistas en español, el modo queda en none', async () => {
    const { result } = await mount()
    expect(result.current.subMode).toBe('none')
  })
})

describe('useSubtitlePrefs — auto-selección', () => {
  test('llega el .srt español → modo external', async () => {
    const { result } = await mount({ ...baseProps, srtCues: [{ start: 0, end: 1, text: 'hola' }] })
    expect(result.current.subMode).toBe('external')
  })

  test('sin srt pero con pista nativa en español → selecciona su id', async () => {
    const tracks: TrackLike[] = [{ id: '2', language: 'es', label: 'Español' }]
    const { result } = await mount({ ...baseProps, subtitleTracks: tracks })
    expect(result.current.subMode).toBe('2')
  })

  test('la elección manual del usuario no se pisa con la auto-selección', async () => {
    const { result, rerender } = await mount()
    act(() => result.current.chooseSubMode('none'))
    expect(result.current.subMode).toBe('none')

    await act(async () => {
      rerender({ ...baseProps, srtCues: [{ start: 0, end: 1, text: 'hola' }] })
    })
    expect(result.current.subMode).toBe('none')
  })
})

describe('useSubtitlePrefs — cambios de estilo y offset', () => {
  test('changeSubStyle mergea el patch y persiste', async () => {
    const { result } = await mount()
    act(() => result.current.changeSubStyle({ size: 'large' }))
    expect(result.current.subStyle).toEqual({ ...DEFAULT_SUBTITLE_STYLE, size: 'large' })
    expect(mockSetSubtitleStyle).toHaveBeenCalledWith({ ...DEFAULT_SUBTITLE_STYLE, size: 'large' })
  })

  test('bumpOffset suma, redondea a un decimal y persiste por offsetKey', async () => {
    const { result } = await mount()
    act(() => result.current.bumpOffset(0.25))
    expect(result.current.subOffset).toBe(0.3)
    expect(mockSetSubtitleOffset).toHaveBeenLastCalledWith('movie:603', 0.3)
  })

  test('bumpOffset topea en ±30s', async () => {
    const { result } = await mount()
    act(() => result.current.bumpOffset(999))
    expect(result.current.subOffset).toBe(30)
    act(() => result.current.bumpOffset(-999))
    expect(result.current.subOffset).toBe(-30)
  })
})
