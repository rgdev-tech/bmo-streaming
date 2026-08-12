import { describe, expect, test, beforeEach } from 'bun:test'
import { act } from 'react-test-renderer'
import { renderHook } from '../test/renderHook'
import { usePlaybackSource, type PlaybackSourceParams } from './usePlaybackSource'
import { stream, getAudioLang, setAudioLang } from '@bmo/core/stream'
import { getProgress } from '@bmo/core/library'
import { makeResolveInfo } from '../test/setup'

const mockStream = stream as unknown as {
  resolveMovie: ReturnType<typeof import('bun:test').mock>
  resolveTv: ReturnType<typeof import('bun:test').mock>
  sources: ReturnType<typeof import('bun:test').mock>
  pickSource: ReturnType<typeof import('bun:test').mock>
}
const mockGetAudioLang = getAudioLang as ReturnType<typeof import('bun:test').mock>
const mockSetAudioLang = setAudioLang as ReturnType<typeof import('bun:test').mock>
const mockGetProgress = getProgress as ReturnType<typeof import('bun:test').mock>

beforeEach(() => {
  mockStream.resolveMovie.mockClear().mockReset()
  mockStream.resolveTv.mockClear().mockReset()
  mockStream.sources.mockClear().mockReset()
  mockStream.pickSource.mockClear().mockReset()
  mockGetAudioLang.mockClear().mockReset()
  mockSetAudioLang.mockClear().mockReset()
  mockGetProgress.mockClear().mockReset()

  mockStream.resolveMovie.mockResolvedValue(makeResolveInfo())
  mockStream.resolveTv.mockResolvedValue(makeResolveInfo())
  mockStream.sources.mockResolvedValue([])
  mockGetAudioLang.mockResolvedValue('latino')
  mockGetProgress.mockResolvedValue(0)
})

async function mount(params: PlaybackSourceParams) {
  const helper = renderHook((p: PlaybackSourceParams) => usePlaybackSource(p), params)
  // Deja correr la cadena async del primer resolve (getProgress → stream.resolveX).
  await act(async () => {})
  await act(async () => {})
  return helper
}

describe('usePlaybackSource — resolución inicial', () => {
  test('película: resuelve con el id y sin exclude', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(mockStream.resolveMovie).toHaveBeenCalledTimes(1)
    expect(mockStream.resolveMovie).toHaveBeenCalledWith(603, 'latino', [])
    expect(result.current.info).not.toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('serie: resuelve con temporada/episodio (default 1/1 si faltan)', async () => {
    const { result } = await mount({ type: 'tv', id: 1399 })
    expect(mockStream.resolveTv).toHaveBeenCalledWith(1399, 1, 1, 'latino', [])
    expect(result.current.info).not.toBeNull()
  })

  test('usa la posición guardada como startAt', async () => {
    mockGetProgress.mockResolvedValue(842)
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(result.current.startAt).toBe(842)
  })

  test('adopta el audioLang persistido si difiere del default', async () => {
    mockGetAudioLang.mockResolvedValue('original')
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(result.current.audioLang).toBe('original')
    // el cambio de audioLang dispara un segundo resolve con el lang correcto
    expect(mockStream.resolveMovie).toHaveBeenLastCalledWith(603, 'original', [])
  })

  test('error de red deja `error` seteado', async () => {
    mockStream.resolveMovie.mockRejectedValue(new Error('network down'))
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(result.current.error).toBe('network down')
    expect(result.current.info).toBeNull()
  })
})

describe('usePlaybackSource — onSourceFailed (fallback multi-fuente)', () => {
  test('excluye la fuente y re-resuelve', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(mockStream.resolveMovie).toHaveBeenCalledTimes(1)

    act(() => result.current.onSourceFailed('realdebrid', 'códec no soportado'))
    await act(async () => {})
    await act(async () => {})

    expect(result.current.excluded).toEqual(['realdebrid'])
    expect(result.current.error).toBeNull()
    expect(mockStream.resolveMovie).toHaveBeenCalledTimes(2)
    expect(mockStream.resolveMovie).toHaveBeenLastCalledWith(603, 'latino', ['realdebrid'])
  })

  test('al llegar al tope de maxFallbacks, deja de excluir y muestra el error', async () => {
    const { result } = await mount({ type: 'movie', id: 603, maxFallbacks: 1 })

    act(() => result.current.onSourceFailed('source-a', 'falló A'))
    await act(async () => {})
    await act(async () => {})
    expect(result.current.excluded).toEqual(['source-a'])

    act(() => result.current.onSourceFailed('source-b', 'falló B — sin más fuentes'))
    await act(async () => {})

    // ya estaba en el tope (excluded.length >= maxFallbacks) → no agrega, muestra error
    expect(result.current.excluded).toEqual(['source-a'])
    expect(result.current.error).toBe('falló B — sin más fuentes')
  })

  test('una fuente ya excluida que vuelve a fallar muestra el error directamente', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    act(() => result.current.onSourceFailed('realdebrid', 'falló 1'))
    await act(async () => {})
    await act(async () => {})
    expect(result.current.excluded).toEqual(['realdebrid'])

    act(() => result.current.onSourceFailed('realdebrid', 'falló de nuevo'))
    expect(result.current.error).toBe('falló de nuevo')
    expect(result.current.excluded).toEqual(['realdebrid'])
  })
})

describe('usePlaybackSource — changeAudioLang', () => {
  test('persiste, resetea calidad/exclusiones y re-resuelve', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    act(() => result.current.onSourceFailed('realdebrid', 'falló'))
    await act(async () => {})
    await act(async () => {})
    expect(result.current.excluded).toEqual(['realdebrid'])

    act(() => result.current.changeAudioLang('original'))
    await act(async () => {})
    await act(async () => {})

    expect(mockSetAudioLang).toHaveBeenCalledWith('original')
    expect(result.current.audioLang).toBe('original')
    expect(result.current.excluded).toEqual([])
    expect(result.current.pickedSource).toBeNull()
    expect(mockStream.resolveMovie).toHaveBeenLastCalledWith(603, 'original', [])
  })

  test('elegir el mismo idioma actual es un no-op', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    const callsBefore = mockStream.resolveMovie.mock.calls.length

    act(() => result.current.changeAudioLang('latino'))
    await act(async () => {})

    expect(mockSetAudioLang).not.toHaveBeenCalled()
    expect(mockStream.resolveMovie.mock.calls.length).toBe(callsBefore)
  })
})

describe('usePlaybackSource — pickSource (menú de calidad)', () => {
  test('cambia de fuente conservando la posición reportada', async () => {
    const picked = makeResolveInfo({ source: 'picked-source' })
    mockStream.pickSource.mockResolvedValue(picked)

    const { result } = await mount({ type: 'movie', id: 603 })
    act(() => result.current.reportPosition(321))

    await act(async () => {
      await result.current.pickSource(2)
    })

    expect(mockStream.pickSource).toHaveBeenCalledWith('movie', 603, 2, undefined, undefined, 'latino')
    expect(result.current.pickedSource).toBe(2)
    expect(result.current.startAt).toBe(321)
    expect(result.current.info?.source).toBe('picked-source')
  })

  test('si pickSource falla, muestra un error genérico', async () => {
    mockStream.pickSource.mockRejectedValue(new Error('boom'))
    const { result } = await mount({ type: 'movie', id: 603 })

    await act(async () => {
      await result.current.pickSource(0)
    })

    expect(result.current.error).toBe('No se pudo abrir esa fuente')
  })
})

describe('usePlaybackSource — lista de fuentes para el menú', () => {
  test('se piden recién cuando ya hay `info` (no compite con el arranque)', async () => {
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(mockStream.sources).toHaveBeenCalledTimes(1)
    expect(result.current.sourcesLoading).toBe(false)
  })
})

describe('usePlaybackSource — enabled (reproducción local)', () => {
  test('enabled:false no toca el API', async () => {
    const { result } = await mount({ type: 'movie', id: 603, enabled: false })
    expect(mockStream.resolveMovie).not.toHaveBeenCalled()
    expect(mockStream.sources).not.toHaveBeenCalled()
    expect(result.current.info).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('al pasar a enabled:true recién ahí resuelve', async () => {
    const { result, rerender } = await mount({ type: 'movie', id: 603, enabled: false })
    expect(mockStream.resolveMovie).not.toHaveBeenCalled()

    await act(async () => { rerender({ type: 'movie', id: 603, enabled: true }) })
    await act(async () => {})

    expect(mockStream.resolveMovie).toHaveBeenCalledWith(603, 'latino', [])
    expect(result.current.info).not.toBeNull()
  })
})

describe('usePlaybackSource — retry', () => {
  test('limpia el error y vuelve a resolver conservando las exclusiones', async () => {
    const { result } = await mount({ type: 'movie', id: 603, maxFallbacks: 1 })

    // Una fuente muere y se excluye; la segunda también → error visible.
    act(() => result.current.onSourceFailed('source-a', 'falló A'))
    await act(async () => {})
    await act(async () => {})
    act(() => result.current.onSourceFailed('source-b', 'falló B'))
    await act(async () => {})
    expect(result.current.error).toBe('falló B')

    const callsBefore = mockStream.resolveMovie.mock.calls.length
    act(() => result.current.retry())
    await act(async () => {})
    await act(async () => {})

    expect(result.current.error).toBeNull()
    expect(mockStream.resolveMovie.mock.calls.length).toBe(callsBefore + 1)
    // No se olvida de lo aprendido: la fuente muerta sigue excluida.
    expect(mockStream.resolveMovie).toHaveBeenLastCalledWith(603, 'latino', ['source-a'])
  })

  test('tras un error de red, el retry vuelve a intentar', async () => {
    mockStream.resolveMovie.mockRejectedValueOnce(new Error('network down'))
    const { result } = await mount({ type: 'movie', id: 603 })
    expect(result.current.error).toBe('network down')

    mockStream.resolveMovie.mockResolvedValue(makeResolveInfo())
    act(() => result.current.retry())
    await act(async () => {})
    await act(async () => {})

    expect(result.current.error).toBeNull()
    expect(result.current.info).not.toBeNull()
  })
})
