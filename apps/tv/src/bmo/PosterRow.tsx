import { FlatList, StyleSheet, Text, TVFocusGuideView } from 'react-native'
import type { MediaItem } from '@bmo/core/tmdb'
import { PosterCard } from './PosterCard'
import { useRowFocusScroll } from './useRowFocusScroll'
import { useRowScroll } from './RowScrollContext'
import { rowHeading, layout, safe } from './theme'

/**
 * Fila horizontal de pósters, equivalente al PosterRow del cliente.
 *
 * Diferencia clave con teléfono: acá no se hace scroll con el dedo. La lista se
 * desplaza sola cuando el foco se mueve más allá del borde visible, así que
 * `initialNumToRender` alto evita que aparezcan huecos en blanco al recorrerla
 * rápido con la cruceta.
 */
export function PosterRow({
  title,
  items,
  onPressItem,
  size = 'normal',
}: {
  title: string
  items: MediaItem[]
  onPressItem?: (item: MediaItem) => void
  /** 'large' = fila destacada con pósters más grandes. */
  size?: 'normal' | 'large'
}) {
  const { ref, focusItem, onScrollToIndexFailed } = useRowFocusScroll<MediaItem>()
  const rowScroll = useRowScroll()

  if (!items?.length) return null

  return (
    // trapFocusRight: al llegar al final de la fila, derecha no salta a otra fila
    // (no hay nada a la derecha; sin esto el foco se iba a la fila diagonal). La
    // izquierda queda libre para poder ir al rail del menú.
    <TVFocusGuideView style={styles.row} trapFocusRight>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        ref={ref}
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <PosterCard
            item={item}
            size={size}
            onPress={onPressItem}
            onFocus={() => { focusItem(index); rowScroll() }}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={onScrollToIndexFailed}
        initialNumToRender={8}
        windowSize={5}
      />
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: layout.rowGap },
  heading: {
    ...rowHeading,
    marginBottom: 10,
    paddingHorizontal: safe.horizontal,
  },
  list: {
    paddingHorizontal: safe.horizontal,
    // Holgura para que la tarjeta enfocada crezca y proyecte sombra sin
    // recortarse contra el borde de la fila.
    paddingVertical: 14,
  },
})
