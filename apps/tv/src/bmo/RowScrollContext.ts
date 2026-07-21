import { createContext, useContext } from 'react'

/**
 * Permite que una fila avise a la ScrollView vertical de la pantalla para que
 * lleve la fila enfocada a una posición CONSISTENTE (siempre a la misma altura),
 * en vez de dejar que el auto-scroll nativo la empuje contra el borde inferior
 * con los pósters cortados. Cada pantalla con filas provee su implementación;
 * fuera de un provider es un no-op (p.ej. la cuadrícula de búsqueda).
 *
 * El argumento `y` es el offset vertical de la fila dentro del contenido.
 */
export const RowScrollContext = createContext<(y: number) => void>(() => {})

export const useRowScroll = () => useContext(RowScrollContext)

// Altura a la que se ancla el tope de la fila enfocada. Deja ver el borde de la
// fila de arriba (contexto) y garantiza que los pósters de abajo entren enteros.
export const ROW_SCROLL_TOP_INSET = 220
