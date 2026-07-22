import { useCallback, useRef, type ReactElement, type ReactNode } from 'react'
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native'
import { RowScrollContext, ROW_SCROLL_TOP_INSET } from './RowScrollContext'
import { safe } from './theme'

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

  const scrollToRow = useCallback((index: number) => {
    if (lastIndex.current === index) return
    lastIndex.current = index
    listRef.current?.scrollToIndex({
      index,
      viewOffset: ROW_SCROLL_TOP_INSET,
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
      <RowScrollContext.Provider value={() => scrollToRow(index)}>
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
      removeClippedSubviews={false}
      windowSize={7}
      initialNumToRender={5}
      maxToRenderPerBatch={3}
      onScrollToIndexFailed={() => {}}
    />
  )
}

const styles = StyleSheet.create({
  // Alto para que la última fila también pueda subir a la altura fija del foco.
  tail: { height: safe.bottom + 320 },
})
