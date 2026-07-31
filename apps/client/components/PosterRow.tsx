import { View, Text, FlatList, StyleSheet } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { type MediaItem } from '@/lib/tmdb'
import { PosterCard } from './PosterCard'
import { Touchable } from './Touchable'
import { rowHeading } from '@/lib/typography'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// Ancho que ocupa cada tarjeta en la fila: los 124 del póster + su separación.
// Tiene que seguir a PosterCard; si cambia allá, cambia acá.
const POSTER_ITEM_W = 124 + 12

export function PosterRow({
  title,
  items,
  // Opcional: hace el encabezado tocable (con chevron) — lo usan las filas de
  // plataforma del catálogo para saltar a /studio/[key]. Mismo patrón que
  // ContinueRow ("Seguir viendo ›").
  onPressTitle,
}: {
  title: string
  items: MediaItem[]
  onPressTitle?: () => void
}) {
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      {onPressTitle ? (
        <Touchable style={styles.headingRow} scaleTo={0.98} haptic="light" onPress={onPressTitle}>
          <Text style={styles.heading}>{title}</Text>
          <SymbolView name="chevron.right" tintColor="#fff" style={styles.chevron} />
        </Touchable>
      ) : (
        <Text style={styles.heading}>{title}</Text>
      )}
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PosterCard item={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        getItemLayout={fixedItemLayout(POSTER_ITEM_W)}
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 24,
  },
  heading: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  // El encabezado ya trae su propio paddingHorizontal, por eso acá no se repite.
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chevron: { width: 16, height: 16, marginBottom: 12 },
  list: {
    paddingHorizontal: 20,
  },
})
