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
const CAT_W = (width - 32 - 12) / 2
const RES_W = Math.floor((width - 32 - 24) / 3)

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const { data: categories } = useAsync(() => tmdb.categories())

  const searching = query.trim().length >= 2

  async function runSearch(q: string) {
    setQuery(q)
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const data = await tmdb.search(q)
      setResults(
        data.results.filter((r) => r.media_type !== 'person' && r.poster_path)
      )
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const header = (
    <Stack.Screen
      options={{
        headerLargeTitle: true,
        title: 'Buscar',
        headerStyle: { backgroundColor: '#000' },
        headerLargeTitleStyle: { color: '#fff' },
        headerTitleStyle: { color: '#fff' },
        headerTintColor: '#fff',
        headerShadowVisible: false,
        headerSearchBarOptions: {
          placeholder: 'Películas, series, actores...',
          barTintColor: '#1C1C1E',
          textColor: '#fff',
          tintColor: '#fff',
          hintTextColor: 'rgba(255,255,255,0.4)',
          headerIconColor: '#fff',
          hideWhenScrolling: false,
          onChangeText: (e) => runSearch(e.nativeEvent.text),
        },
      }}
    />
  )

  if (searching) {
    return (
      <>
        {header}
        <FlatList
          style={styles.container}
          contentInsetAdjustmentBehavior="automatic"
          data={results}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          numColumns={3}
          columnWrapperStyle={styles.resCol}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <PosterCard item={item} width={RES_W} />}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color="#fff" style={styles.spinner} />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.hint}>Sin resultados</Text>
              </View>
            )
          }
        />
      </>
    )
  }

  return (
    <>
      {header}
      <FlatList
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        data={categories ?? []}
        keyExtractor={(c) => `${c.type}-${c.genreId}`}
        numColumns={2}
        columnWrapperStyle={styles.catCol}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => <CategoryCard cat={item} width={CAT_W} />}
        ListEmptyComponent={
          <ActivityIndicator color="#fff" style={styles.spinner} />
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },
  catCol: { gap: 12, marginBottom: 12 },
  resCol: { gap: 0, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 100, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16 },
})
