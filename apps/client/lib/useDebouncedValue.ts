import { useEffect, useState } from 'react'

/**
 * Devuelve `value` con un retardo: sólo se actualiza cuando pasó `delay` sin
 * que vuelva a cambiar. Sirve para no disparar una búsqueda por cada tecla.
 *
 * 300 ms es el punto donde la mayoría de la gente ya terminó de escribir la
 * palabra pero todavía no percibe espera.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
