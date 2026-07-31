import type { MediaItem } from './tmdb'

// Debajo de esto una fila se ve pobre y conviene dejarla repetir algo antes que
// mostrarla medio vacía (o peor, esconderla y que la pantalla cambie de forma
// según la hora del día).
const MIN_ROW = 6

export type Row<T extends { id: number }> = { key: string; items: T[] }

/**
 * Quita de cada fila los títulos que YA aparecieron en una fila anterior.
 *
 * El Home mezcla fuentes que se solapan mucho: lo que es tendencia también es
 * popular, y lo popular suele estar en Netflix. Medido contra la API real, 53
 * de 200 tarjetas —el 26% del Home— eran un título repetido, y varios salían
 * cuatro veces en la misma pantalla. Eso hace que el catálogo se sienta más
 * chico de lo que es.
 *
 * El orden de las filas ES la prioridad: la primera que pide un título se lo
 * queda. Por eso conviene pasar primero las filas más "editorializadas"
 * (destacados, seguir viendo) y después las genéricas.
 *
 * Si a una fila le quedan muy pocos elementos propios, se la rellena con los
 * que se le habían quitado: una fila corta se nota más que una repetición
 * ocasional bien abajo en la pantalla.
 */
export function dedupeRows<T extends { id: number }>(
  rows: Row<T>[],
  opts: { minRow?: number; exclude?: Iterable<number> } = {}
): Record<string, T[]> {
  const minRow = opts.minRow ?? MIN_ROW
  const seen = new Set<number>(opts.exclude ?? [])
  const out: Record<string, T[]> = {}

  for (const row of rows) {
    const fresh: T[] = []
    const taken: T[] = []
    for (const item of row.items) {
      if (seen.has(item.id)) taken.push(item)
      else fresh.push(item)
    }

    const result = fresh.length >= minRow ? fresh : [...fresh, ...taken.slice(0, minRow - fresh.length)]
    for (const item of result) seen.add(item.id)
    out[row.key] = result
  }

  return out
}

// Ids de los títulos que ocupa el hero. Se excluyen del resto del Home: verlos
// en la portada gigante y otra vez tres filas más abajo es la repetición más
// evidente de todas.
export function heroIds(items: MediaItem[], count: number): number[] {
  return items.filter((i) => i.backdrop_path).slice(0, count).map((i) => i.id)
}
