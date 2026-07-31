import { describe, expect, test, beforeEach, afterEach, jest } from 'bun:test'
import { act } from 'react-test-renderer'
import { renderHook } from '../test/renderHook'
import { useAutoHideControls, useSeekHint } from './useAutoHideControls'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('useAutoHideControls', () => {
  test('arranca visible y se auto-oculta tras el timeout', () => {
    const { result } = renderHook(() => useAutoHideControls({ timeout: 1000 }), {})
    expect(result.current.controlsVisible).toBe(true)

    act(() => { jest.advanceTimersByTime(999) })
    expect(result.current.controlsVisible).toBe(true)

    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current.controlsVisible).toBe(false)
  })

  test('reveal() muestra y reprograma el auto-hide', () => {
    const { result } = renderHook(() => useAutoHideControls({ timeout: 1000 }), {})
    act(() => { jest.advanceTimersByTime(1000) })
    expect(result.current.controlsVisible).toBe(false)

    act(() => result.current.reveal())
    expect(result.current.controlsVisible).toBe(true)

    act(() => { jest.advanceTimersByTime(999) })
    expect(result.current.controlsVisible).toBe(true)
    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current.controlsVisible).toBe(false)
  })

  test('hide() oculta al toque, cancelando el timer pendiente', () => {
    const { result } = renderHook(() => useAutoHideControls({ timeout: 1000 }), {})
    act(() => result.current.hide())
    expect(result.current.controlsVisible).toBe(false)
  })

  test('con menuOpen no se auto-oculta; al cerrar el menú se reprograma', () => {
    const { result, rerender } = renderHook(
      (props: { menuOpen: boolean }) => useAutoHideControls({ menuOpen: props.menuOpen, timeout: 1000 }),
      { menuOpen: false }
    )

    act(() => rerender({ menuOpen: true }))
    expect(result.current.controlsVisible).toBe(true)

    // anclado: pasa de sobra el timeout y sigue visible
    act(() => { jest.advanceTimersByTime(5000) })
    expect(result.current.controlsVisible).toBe(true)

    act(() => rerender({ menuOpen: false }))
    expect(result.current.controlsVisible).toBe(true)
    act(() => { jest.advanceTimersByTime(1000) })
    expect(result.current.controlsVisible).toBe(false)
  })

  test('controlsVisibleRef refleja el estado actual sin capturar uno viejo', () => {
    const { result } = renderHook(() => useAutoHideControls({ timeout: 1000 }), {})
    expect(result.current.controlsVisibleRef.current).toBe(true)
    act(() => { jest.advanceTimersByTime(1000) })
    expect(result.current.controlsVisibleRef.current).toBe(false)
  })
})

describe('useSeekHint', () => {
  test('arranca en 0 (oculto)', () => {
    const { result } = renderHook(() => useSeekHint(), {})
    expect(result.current.seekHint).toBe(0)
  })

  test('flashSeek acumula saltos seguidos', () => {
    const { result } = renderHook(() => useSeekHint(), {})
    act(() => result.current.flashSeek(10))
    expect(result.current.seekHint).toBe(10)
    act(() => result.current.flashSeek(10))
    expect(result.current.seekHint).toBe(20)
    act(() => result.current.flashSeek(-5))
    expect(result.current.seekHint).toBe(15)
  })

  test('se desvanece solo tras el timeout', () => {
    const { result } = renderHook(() => useSeekHint(), {})
    act(() => result.current.flashSeek(10))
    act(() => { jest.advanceTimersByTime(899) })
    expect(result.current.seekHint).toBe(10)
    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current.seekHint).toBe(0)
  })

  test('un salto nuevo reprograma el desvanecimiento desde cero', () => {
    const { result } = renderHook(() => useSeekHint(), {})
    act(() => result.current.flashSeek(10))
    act(() => { jest.advanceTimersByTime(800) })
    act(() => result.current.flashSeek(10))
    act(() => { jest.advanceTimersByTime(800) })
    expect(result.current.seekHint).toBe(20)
    act(() => { jest.advanceTimersByTime(100) })
    expect(result.current.seekHint).toBe(0)
  })
})
