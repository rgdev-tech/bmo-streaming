import { useCallback, useRef } from 'react'
import type { FlatList } from 'react-native'
import { safe } from './theme'

/**
 * Mantiene el ítem enfocado en una posición horizontal CONSISTENTE al recorrer
 * una fila con la cruceta — alineado al margen del contenido (justo bajo el
 * título de la fila), como Apple TV.
 *
 * Por defecto, el auto-scroll nativo de tvOS solo mueve la lista lo justo para
 * que el ítem entre en pantalla, dejándolo pegado al borde derecho al avanzar:
 * es lo que se sentía "descuadrado". Acá, en cada foco hacemos un scrollToIndex
 * con viewPosition 0 (borde izquierdo del ítem) + viewOffset = el padding
 * izquierdo de la fila, así el ítem enfocado siempre cae en el mismo lugar y la
 * fila se desliza por debajo, en vez de que el ítem salte contra el borde.
 *
 * `leftOffset` = el paddingLeft del contentContainer de la fila, para que la
 * posición de reposo del ítem 0 coincida con la del resto.
 */
export function useRowFocusScroll<T>(leftOffset: number = safe.horizontal) {
  const ref = useRef<FlatList<T>>(null)

  const focusItem = useCallback(
    (index: number) => {
      ref.current?.scrollToIndex({
        // Instantáneo (sin animar): la fila se pega en lockstep con el foco, sin
        // el "arrastre" de la animación que se sentía a tirones al recorrer rápido.
        // El realce suave lo da la escala de la tarjeta (useFocusScale).
        index,
        animated: false,
        viewPosition: 0,
        viewOffset: leftOffset,
      })
    },
    [leftOffset]
  )

  // Si el ítem aún no está medido (raro: el foco solo llega a ítems renderizados),
  // no reventamos — el próximo movimiento reintenta.
  const onScrollToIndexFailed = useCallback(() => {}, [])

  return { ref, focusItem, onScrollToIndexFailed }
}
