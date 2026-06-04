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
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterCard } from '@/components/PosterCard'
import { CategoryCard } from '@/components/CategoryCard'

const { width } = Dimensions.get('window')
const CAT_W = Math.floor((width - 32 - 24) / 3)
const RES_W = CAT_W

export default function SearchScreen() {
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

  if (searching) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Buscar',
            headerLargeTitle: true,
            headerSearchBarOptions: {
              placeholder: 'Películas, series, actores...',
              onChangeText: (e) => runSearch(e.nativeEvent.text),
              hideWhenScrolling: false,
              autoCapitalize: 'none',
            },
          }}
        />
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          data={results}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          numColumns={3}
          columnWrapperStyle={styles.resCol}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <PosterCard item={item} width={RES_W} />}
          ListEmptyComponent={
            loading
              ? <ActivityIndicator color="#fff" style={styles.spinner} />
              : <View style={styles.empty}><Text style={styles.hint}>Sin resultados</Text></View>
          }
        />
      </>
    )
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Buscar',
          headerLargeTitle: true,
          headerSearchBarOptions: {
            placeholder: 'Películas, series, actores...',
            onChangeText: (e) => runSearch(e.nativeEvent.text),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
          },
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={categories ?? []}
        keyExtractor={(c) => `${c.type}-${c.genreId}`}
        numColumns={3}
        columnWrapperStyle={styles.catCol}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => <CategoryCard cat={item} width={CAT_W} />}
        ListEmptyComponent={<ActivityIndicator color="#fff" style={styles.spinner} />}
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 120 },
  catCol: { gap: 12, marginBottom: 12 },
  resCol: { gap: 12, marginBottom: 12, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 100, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16 },
})
