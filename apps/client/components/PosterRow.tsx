import { View, Text, FlatList, StyleSheet } from 'react-native'
import { type MediaItem } from '@/lib/tmdb'
import { PosterCard } from './PosterCard'

export function PosterRow({
  title,
  items,
}: {
  title: string
  items: MediaItem[]
}) {
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PosterCard item={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 24,
  },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  list: {
    paddingHorizontal: 20,
  },
})
