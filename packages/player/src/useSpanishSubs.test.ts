import { describe, expect, test, mock } from 'bun:test'
import { act } from 'react-test-renderer'
import { renderHook } from '../test/renderHook'
import { useSpanishSubs, type SpanishSubsOptions } from './useSpanishSubs'
import { makeResolveInfo } from '../test/setup'
import type { ResolveInfo } from '@bmo/core/stream'
import type { SrtCue } from '@bmo/core/srt'

async function mount(info: ResolveInfo | null, opts: SpanishSubsOptions = {}) {
  const helper = renderHook(
    (p: { info: ResolveInfo | null; opts: SpanishSubsOptions }) => useSpanishSubs(p.info, p.opts),
    { info, opts }
  )
  await act(async () => {})
  return helper
}

describe('useSpanishSubs', () => {
  test('sin info todavía, no hay cues', async () => {
    const fetcher = mock(async () => [{ start: 0, end: 1, text: 'x' }] as SrtCue[])
    const { result } = await mount(null, { fetcher })
    expect(result.current).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('fuente file → baja y devuelve las cues del fetcher', async () => {
    const cues: SrtCue[] = [{ start: 0, end: 2, text: 'hola' }]
    const fetcher = mock(async () => cues)
    const info = makeResolveInfo({ type: 'file' })
    const { result } = await mount(info, { fetcher })
    expect(fetcher).toHaveBeenCalledWith(info.subtitles)
    expect(result.current).toEqual(cues)
  })

  test('fuente hls (ya trae pistas proxeadas) → no baja nada por default', async () => {
    const fetcher = mock(async () => [{ start: 0, end: 1, text: 'x' }] as SrtCue[])
    const info = makeResolveInfo({ type: 'hls' })
    await mount(info, { fetcher })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('enabledFor custom puede habilitar hls también', async () => {
    const fetcher = mock(async () => [] as SrtCue[])
    const info = makeResolveInfo({ type: 'hls' })
    await mount(info, { fetcher, enabledFor: () => true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test('si el fetcher falla, no revienta y deja las cues vacías', async () => {
    const fetcher = mock(async () => {
      throw new Error('boom')
    })
    const info = makeResolveInfo({ type: 'file' })
    const { result } = await mount(info, { fetcher })
    expect(result.current).toEqual([])
  })

  test('cambiar de fuente re-descarga y reemplaza las cues', async () => {
    const cuesA: SrtCue[] = [{ start: 0, end: 1, text: 'A' }]
    const cuesB: SrtCue[] = [{ start: 0, end: 1, text: 'B' }]
    const fetcher = mock(async (subs: unknown) => (subs === infoA.subtitles ? cuesA : cuesB))
    const infoA = makeResolveInfo({ type: 'file', source: 'a' })
    const infoB = makeResolveInfo({ type: 'file', source: 'b' })

    const { result, rerender } = await mount(infoA, { fetcher })
    expect(result.current).toEqual(cuesA)

    await act(async () => {
      rerender({ info: infoB, opts: { fetcher } })
    })
    expect(result.current).toEqual(cuesB)
  })
})
