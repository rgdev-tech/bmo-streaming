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

  // El ítem destino aún no estaba medido: pasa al recorrer rápido, sobre todo al
  // VOLVER a la izquierda hacia ítems que la virtualización recicló. Antes esto
  // era un no-op y el póster enfocado quedaba descuadrado a mitad de pantalla
  // hasta el próximo paso —el "brinco" que se sentía. Ahora lo posicionamos igual:
  // como las tarjetas son de ancho UNIFORME, `averageItemLength` es el ancho de
  // tarjeta, así que scrollToOffset(index × averageItemLength) deja el ítem
  // exactamente donde lo pondría scrollToIndex (el paddingLeft de la fila =
  // leftOffset y se cancela). Sin reintentos → sin saltos.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      ref.current?.scrollToOffset({ offset: info.index * info.averageItemLength, animated: false })
    },
    []
  )

  return { ref, focusItem, onScrollToIndexFailed }
}
