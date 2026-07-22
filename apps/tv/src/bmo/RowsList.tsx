import { useCallback, useRef, type ReactElement, type ReactNode } from 'react'
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native'
import { RowScrollContext, ROW_SCROLL_TOP_INSET } from './RowScrollContext'
import { layout, safe } from './theme'

export type RowSection = { key: string; node: ReactNode }

/**
 * Lista vertical de filas VIRTUALIZADA. Antes las pantallas usaban un ScrollView
 * que montaba TODAS las filas a la vez (decenas de FlatLists con imágenes) —
 * pesado en el emulador. Acá solo se montan las filas cercanas al viewport.
 *
 * El scroll-al-foco va por ÍNDICE de fila (no por Y medido, que con filas
 * virtualizadas no es confiable): cada fila recibe, vía RowScrollContext, un
 * callback ligado a su índice que hace scrollToIndex a la altura fija del foco.
 * Dedup por índice para no re-scrollear al moverse en horizontal.
 */
export function RowsList({
  header,
  sections,
}: {
  header?: ReactElement | null
  sections: RowSection[]
}) {
  const listRef = useRef<FlatList<RowSection>>(null)
  const lastIndex = useRef(-1)

  const scrollToRow = useCallback((index: number, itemHeight = layout.posterHeight) => {
    if (lastIndex.current === index) return
    lastIndex.current = index
    // Compensa el alto de la tarjeta contra el de referencia (póster normal), para
    // que el CENTRO del ítem enfocado caiga siempre en la misma línea vertical.
    // Una fila más alta (large) sube un poco su tope; una más baja (apaisada) lo
    // baja. Sin esto, el foco saltaba de altura entre filas de distinto tamaño.
    const viewOffset = ROW_SCROLL_TOP_INSET - (itemHeight - layout.posterHeight) / 2
    listRef.current?.scrollToIndex({
      index,
      viewOffset,
      viewPosition: 0,
      // Instantáneo (sin animar), mismo criterio que el scroll horizontal
      // (useRowFocusScroll): al bajar rápido con la cruceta, animar cada salto
      // encadenaba glides de ~300ms que se re-apuntaban a mitad de camino y se
      // sentían "a tirones". Sin animar, la lista se pega en lockstep con el
      // foco; el realce suave lo da la escala de la tarjeta (useFocusScale).
      animated: false,
    })
  }, [])

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<RowSection>) => (
      <RowScrollContext.Provider value={(itemHeight) => scrollToRow(index, itemHeight)}>
        {item.node}
      </RowScrollContext.Provider>
    ),
    [scrollToRow]
  )

  return (
    <FlatList
      ref={listRef}
      data={sections}
      keyExtractor={(s) => s.key}
      renderItem={renderItem}
      ListHeaderComponent={header ?? null}
      ListFooterComponent={<View style={styles.tail} />}
      showsVerticalScrollIndicator={false}
      // En TV, detachar vistas fuera de pantalla les saca el foco: mejor mantener
      // montadas las cercanas (windowSize) y no clippear.
      //
      // windowSize 5 (antes 7): en catálogos con muchas filas de género, 7 dejaba
      // montadas casi todas a la vez (cada una un FlatList con imágenes), lo que
      // presiona memoria/GC en el emulador. 5 virtualiza más y sigue teniendo un
      // par de filas de colchón arriba y abajo del viewport para que el foco no
      // caiga en una fila sin montar. maxToRenderPerBatch un poco más alto para
      // que, al recorrer rápido, las filas nuevas se llenen antes de verse en blanco.
      removeClippedSubviews={false}
      windowSize={5}
      initialNumToRender={5}
      maxToRenderPerBatch={4}
      onScrollToIndexFailed={() => {}}
    />
  )
}

const styles = StyleSheet.create({
  // Alto para que la última fila también pueda subir a la altura fija del foco.
  tail: { height: safe.bottom + 320 },
})
