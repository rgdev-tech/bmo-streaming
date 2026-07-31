import { describe, expect, test } from 'bun:test'
import { dedupeRows, heroIds } from './dedupeRows'

const item = (id: number) => ({ id })
// Fila lo bastante larga para que el mínimo (6) no se meta en el medio y tape
// lo que cada caso quiere probar.
const many = (from: number, count = 10) =>
  Array.from({ length: count }, (_, i) => item(from + i))

describe('dedupeRows', () => {
  test('un título sólo aparece en la primera fila que lo pide', () => {
    const out = dedupeRows([
      { key: 'a', items: [...many(1), item(99)] },
      { key: 'b', items: [...many(20), item(99)] },
    ])
    expect(out.a.map((i) => i.id)).toContain(99)
    expect(out.b.map((i) => i.id)).not.toContain(99)
  })

  test('el orden de las filas es la prioridad', () => {
    const out = dedupeRows([
      { key: 'primera', items: many(1) },
      { key: 'segunda', items: many(1) },
    ])
    expect(out.primera).toHaveLength(10)
    // La segunda pedía exactamente lo mismo: se queda sólo con el relleno mínimo.
    expect(out.segunda).toHaveLength(6)
  })

  test('excluye lo que ya ocupa el hero', () => {
    const out = dedupeRows([{ key: 'a', items: many(1) }], { exclude: [1, 2, 3] })
    const ids = out.a.map((i) => i.id)
    expect(ids).not.toContain(1)
    expect(ids).not.toContain(2)
    expect(ids).not.toContain(3)
  })

  test('una fila corta se rellena antes que quedar casi vacía', () => {
    const out = dedupeRows([
      { key: 'a', items: many(1) },
      // Sólo dos títulos propios; el resto ya se los llevó la fila anterior.
      { key: 'b', items: [...many(1, 8), item(50), item(51)] },
    ])
    // 2 propios + 4 recuperados = el mínimo de 6.
    expect(out.b).toHaveLength(6)
    expect(out.b.map((i) => i.id)).toEqual(expect.arrayContaining([50, 51]))
  })

  test('no rellena de más si la fila ya llega al mínimo', () => {
    const out = dedupeRows([
      { key: 'a', items: many(1) },
      { key: 'b', items: [...many(1, 3), ...many(50, 6)] },
    ])
    expect(out.b).toHaveLength(6)
    expect(out.b.every((i) => i.id >= 50)).toBe(true)
  })

  test('minRow configurable', () => {
    const out = dedupeRows(
      [
        { key: 'a', items: many(1) },
        { key: 'b', items: [...many(1), item(50)] },
      ],
      { minRow: 3 }
    )
    expect(out.b).toHaveLength(3)
  })

  test('fila vacía no rompe', () => {
    const out = dedupeRows([{ key: 'a', items: [] }])
    expect(out.a).toEqual([])
  })
})

describe('heroIds', () => {
  test('toma los primeros con backdrop', () => {
    const items = [
      { id: 1, backdrop_path: null },
      { id: 2, backdrop_path: '/b.jpg' },
      { id: 3, backdrop_path: '/c.jpg' },
      { id: 4, backdrop_path: '/d.jpg' },
    ] as never[]
    expect(heroIds(items, 2)).toEqual([2, 3])
  })

  test('sin backdrops devuelve vacío', () => {
    const items = [{ id: 1, backdrop_path: null }] as never[]
    expect(heroIds(items, 3)).toEqual([])
  })
})
