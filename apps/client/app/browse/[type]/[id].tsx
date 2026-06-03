import { useLocalSearchParams, Stack } from 'expo-router'
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterCard } from '@/components/PosterCard'

const { width } = Dimensions.get('window')
const CARD = Math.floor((width - 32 - 24) / 3)

export default function BrowseScreen() {
  const { type, id, name } = useLocalSearchParams<{
    type: string
    id: string
    name: string
  }>()
  const kind = type === 'tv' ? 'tv' : 'movie'
  const { data, loading } = useAsync(() => tmdb.discover(kind, id), [type, id])

  const items = (data?.results ?? []).filter((i) => i.poster_path)

  return (
    <>
      <Stack.Screen
        options={{
          headerLargeTitle: true,
          title: name ?? 'Categoría',
          headerStyle: { backgroundColor: '#000' },
          headerLargeTitleStyle: { color: '#fff' },
          headerTitleStyle: { color: '#fff' },
          headerTintColor: '#fff',
          headerShadowVisible: false,
        }}
      />
      <FlatList
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={(item) => String(item.id)}
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <PosterCard item={{ ...item, media_type: kind } as MediaItem} width={CARD} />
        )}
        ListEmptyComponent={
          loading ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },
  col: { gap: 0, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
})
