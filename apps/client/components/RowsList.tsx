import { useCallback, type ReactElement, type ReactNode } from 'react'
import { Animated, StyleSheet, View, type ListRenderItemInfo } from 'react-native'

export type RowSection = { key: string; node: ReactNode }

const AnimatedFlatList = Animated.FlatList<RowSection>

/**
 * Lista vertical de filas VIRTUALIZADA para las pantallas de catálogo.
 *
 * Antes el Home era un ScrollView plano con las once filas escritas una debajo
 * de la otra: montaba TODAS de entrada, y cada una es a su vez un carrusel
 * horizontal con imágenes. El costo se paga en el arranque de la pantalla, en
 * memoria y en el scroll. Acá sólo viven las filas cercanas al viewport.
 *
 * Es el equivalente de apps/tv/src/bmo/RowsList.tsx, sin la parte de foco: en
 * teléfono no hay cruceta que perseguir, así que no hace falta el scroll por
 * índice ni el contexto que lo distribuye.
 */
export function RowsList({
  header,
  sections,
  onScroll,
  contentPaddingBottom = 90,
}: {
  header?: ReactElement | null
  sections: RowSection[]
  // Handler de Animated.event: lo usa el hero para su parallax y el título de
  // la pantalla para desvanecerse.
  onScroll?: (...args: any[]) => void
  contentPaddingBottom?: number
}) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RowSection>) => <>{item.node}</>,
    []
  )

  return (
    <AnimatedFlatList
      data={sections}
      keyExtractor={(s) => s.key}
      renderItem={renderItem}
      ListHeaderComponent={header ?? null}
      ListFooterComponent={<View style={{ height: contentPaddingBottom }} />}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      onScroll={onScroll}
      scrollEventThrottle={16}
      // removeClippedSubviews en iOS tiene fama de dejar celdas en blanco
      // cuando adentro hay listas horizontales — que es exactamente este caso.
      // La virtualización de FlatList ya hace el trabajo pesado sin él.
      removeClippedSubviews={false}
      // El viewport de un teléfono muestra dos filas y pico: con 3 iniciales la
      // pantalla entra llena y el resto se completa mientras baja el dedo.
      initialNumToRender={3}
      windowSize={5}
      maxToRenderPerBatch={3}
    />
  )
}

export const rowsListStyles = StyleSheet.create({
  container: { flex: 1 },
})
