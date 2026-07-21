import { createContext, useContext } from 'react'

/**
 * Llamar (sin argumentos) para llevar ESTA fila a la altura fija del foco. El
 * provider lo instancia por fila dentro de la FlatList vertical (cada fila tiene
 * su callback ligado a su índice), así el scroll funciona con virtualización sin
 * depender de medir la Y absoluta —que con filas virtualizadas no es confiable.
 *
 * Fuera de un provider es un no-op (p.ej. la cuadrícula de búsqueda o Biblioteca).
 */
export const RowScrollContext = createContext<() => void>(() => {})

export const useRowScroll = () => useContext(RowScrollContext)

// Altura a la que se ancla el tope de la fila enfocada. Deja ver el borde de la
// fila de arriba (contexto) y garantiza que los pósters de abajo entren enteros.
export const ROW_SCROLL_TOP_INSET = 220
