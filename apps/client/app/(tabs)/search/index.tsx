import { Stack } from 'expo-router'
import { useState } from 'react'
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterCard } from '@/components/PosterCard'
import { CategoryCard } from '@/components/CategoryCard'

const { width } = Dimensions.get('window')
const CAT_W = Math.floor((width - 32 - 24) / 3)
const RES_W = CAT_W

export default function SearchScreen() {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const { data: categories } = useAsync(() => tmdb.categories())

  const searching = query.trim().length >= 2

  async function runSearch(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const data = await tmdb.search(q)
      setResults(data.results.filter((r) => r.media_type !== 'person' && r.poster_path))
    } catch { setResults([]) }
    finally { setLoading(false) }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        style={styles.list}
        data={searching ? results : (categories ?? [])}
        keyExtractor={(item: any) =>
          searching
            ? `${item.media_type}-${item.id}`
            : `${item.type}-${item.genreId}`
        }
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8 },
        ]}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: any) =>
          searching
            ? <PosterCard item={item} width={RES_W} />
            : <CategoryCard cat={item} width={CAT_W} />
        }
        ListEmptyComponent={
          searching && loading
            ? <ActivityIndicator color="#fff" style={styles.spinner} />
            : searching
            ? <View style={styles.empty}><Text style={styles.hint}>Sin resultados</Text></View>
            : <ActivityIndicator color="#fff" style={styles.spinner} />
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 120 },
  col: { gap: 12, marginBottom: 12, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 100, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16 },
})
