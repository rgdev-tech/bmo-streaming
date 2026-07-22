import { createContext, useContext } from 'react'

/**
 * Llamar con el ALTO DE TARJETA de la fila para llevar ESTA fila a la altura fija
 * del foco. El provider lo instancia por fila dentro de la FlatList vertical (cada
 * fila tiene su callback ligado a su índice), así el scroll funciona con
 * virtualización sin depender de medir la Y absoluta —que con filas virtualizadas
 * no es confiable.
 *
 * El alto de tarjeta permite que el CENTRO del ítem enfocado caiga siempre en la
 * misma línea vertical, sin importar si la fila es de pósters grandes (252),
 * normales (186) o apaisados (140). Sin esto, el foco "saltaba" de altura al
 * pasar entre filas de distinto tamaño.
 *
 * Fuera de un provider es un no-op (p.ej. la cuadrícula de búsqueda o Biblioteca).
 */
export const RowScrollContext = createContext<(itemHeight?: number) => void>(() => {})

export const useRowScroll = () => useContext(RowScrollContext)

// Altura a la que se ancla el CENTRO del ítem enfocado de una fila de altura de
// referencia (póster normal). Las filas más altas/bajas se compensan contra esto
// en RowsList. Deja ver el borde de la fila de arriba (contexto).
export const ROW_SCROLL_TOP_INSET = 220
