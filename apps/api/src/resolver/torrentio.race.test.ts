import { describe, expect, test } from 'bun:test'
import { raceInWaves, type Wave } from './torrentio'

// Olas diminutas: como `waves` es un parámetro, los tests no esperan segundos.
const WAVES: Wave[] = [
  { count: 2, waitMs: 50 },
  { count: 5, waitMs: 80 },
]

const never = () => new Promise<string>(() => {})
const after = (ms: number, v: string) => new Promise<string>((r) => setTimeout(() => r(v), ms))
const fails = () => Promise.reject(new Error('no resolvió'))

describe('raceInWaves', () => {
  test('el mejor candidato gana sin abrir la segunda ola', async () => {
    const started: string[] = []
    const cands = ['a', 'b', 'c', 'd', 'e']
    const got = await raceInWaves(cands, WAVES, (c) => {
      started.push(c)
      return c === 'a' ? after(5, 'a') : never()
    })
    expect(got).toBe('a')
    // Solo arrancó la primera ola: los peores nunca se tocaron.
    expect(started).toEqual(['a', 'b'])
  })

  test('si la primera ola se cuelga, la segunda rescata', async () => {
    const cands = ['a', 'b', 'c', 'd']
    const got = await raceInWaves(cands, WAVES, (c) => (c === 'd' ? after(5, 'd') : never()))
    expect(got).toBe('d')
  })

  test('si toda la ola falla rápido, avanza sin esperar el waitMs', async () => {
    const t0 = Date.now()
    const got = await raceInWaves(['a', 'b', 'c'], WAVES, (c) => (c === 'c' ? after(5, 'c') : fails()))
    expect(got).toBe('c')
    // Si hubiera esperado el waitMs de la primera ola sería >= 50ms.
    expect(Date.now() - t0).toBeLessThan(50)
  })

  test('si todos fallan devuelve null', async () => {
    expect(await raceInWaves(['a', 'b', 'c'], WAVES, fails)).toBeNull()
  })

  test('lista vacía devuelve null', async () => {
    expect(await raceInWaves([], WAVES, fails)).toBeNull()
  })

  test('cada candidato se intenta UNA sola vez entre olas', async () => {
    // Reintentar dispararía un segundo resolve del mismo torrent en Real-Debrid.
    const calls: string[] = []
    await raceInWaves(['a', 'b', 'c', 'd'], WAVES, (c) => {
      calls.push(c)
      return c === 'd' ? after(5, 'd') : never()
    })
    expect(calls).toEqual([...new Set(calls)])
  })
})
