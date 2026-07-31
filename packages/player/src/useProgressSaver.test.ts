import { describe, expect, test, beforeEach, afterEach, jest } from 'bun:test'
import { act } from 'react-test-renderer'
import { renderHook } from '../test/renderHook'
import { useProgressSaver } from './useProgressSaver'
import { saveProgress } from '@bmo/core/library'
import type { MediaMeta } from './types'

const mockSaveProgress = saveProgress as ReturnType<typeof import('bun:test').mock>

const meta: MediaMeta = {
  id: 603,
  media_type: 'movie',
  title: 'The Matrix',
  poster_path: null,
  backdrop_path: null,
}

beforeEach(() => {
  mockSaveProgress.mockClear().mockReset().mockResolvedValue(undefined)
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2024, 0, 1, 0, 0, 0))
})

afterEach(() => jest.useRealTimers())

describe('useProgressSaver', () => {
  test('duration=0 (todavía no cargó) no guarda nada', () => {
    const { result } = renderHook(() => useProgressSaver(meta), {})
    act(() => result.current.report(0, 0))
    expect(mockSaveProgress).not.toHaveBeenCalled()
  })

  test('primer report con time/duration válidos guarda de inmediato', () => {
    const { result } = renderHook(() => useProgressSaver(meta), {})
    act(() => result.current.report(30, 7200))
    expect(mockSaveProgress).toHaveBeenCalledTimes(1)
    expect(mockSaveProgress).toHaveBeenCalledWith({ ...meta, position: 30, duration: 7200 })
  })

  test('reports seguidos dentro del throttle no vuelven a guardar', () => {
    const { result } = renderHook(() => useProgressSaver(meta), {})
    act(() => result.current.report(30, 7200))
    jest.setSystemTime(new Date(2024, 0, 1, 0, 0, 3)) // +3s, bajo el throttle de 5s
    act(() => result.current.report(33, 7200))
    expect(mockSaveProgress).toHaveBeenCalledTimes(1)
  })

  test('pasado el throttle (5s), el siguiente report vuelve a guardar', () => {
    const { result } = renderHook(() => useProgressSaver(meta), {})
    act(() => result.current.report(30, 7200))
    jest.setSystemTime(new Date(2024, 0, 1, 0, 0, 6)) // +6s
    act(() => result.current.report(36, 7200))
    expect(mockSaveProgress).toHaveBeenCalledTimes(2)
    expect(mockSaveProgress).toHaveBeenLastCalledWith({ ...meta, position: 36, duration: 7200 })
  })

  test('al desmontar guarda el progreso final aunque esté dentro del throttle', () => {
    const { result, unmount } = renderHook(() => useProgressSaver(meta), {})
    act(() => result.current.report(30, 7200))
    jest.setSystemTime(new Date(2024, 0, 1, 0, 0, 1)) // +1s, sigue dentro del throttle
    act(() => result.current.report(31, 7200))
    expect(mockSaveProgress).toHaveBeenCalledTimes(1) // el segundo report no guardó (throttle)

    unmount()
    expect(mockSaveProgress).toHaveBeenCalledTimes(2)
    expect(mockSaveProgress).toHaveBeenLastCalledWith({ ...meta, position: 31, duration: 7200 })
  })

  test('al desmontar sin duration nunca reportada, no guarda', () => {
    const { unmount } = renderHook(() => useProgressSaver(meta), {})
    unmount()
    expect(mockSaveProgress).not.toHaveBeenCalled()
  })
})
