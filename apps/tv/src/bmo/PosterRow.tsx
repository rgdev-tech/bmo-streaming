import { FlatList, StyleSheet, Text, View } from 'react-native'
import type { MediaItem } from '@bmo/core/tmdb'
import { PosterCard } from './PosterCard'
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
}: {
  title: string
  items: MediaItem[]
  onPressItem?: (item: MediaItem) => void
}) {
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PosterCard item={item} onPress={onPressItem} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={8}
        windowSize={5}
      />
    </View>
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
