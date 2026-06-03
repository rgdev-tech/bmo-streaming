import { Stack } from 'expo-router'
import { useState } from 'react'
import { FlatList, View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { PosterCard } from '@/components/PosterCard'

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)

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

  return (
    <>
      <Stack.Screen
        options={{
          headerLargeTitle: true,
          title: 'Buscar',
          headerSearchBarOptions: {
            placeholder: 'Películas, series, actores...',
            barTintColor: '#1C1C1E',
            textColor: '#fff',
            tintColor: '#fff',
            hintTextColor: 'rgba(255,255,255,0.4)',
            headerIconColor: '#fff',
            hideWhenScrolling: false,
            autoFocus: true,
            onChangeText: (e) => runSearch(e.nativeEvent.text),
          },
        }}
      />
      <FlatList
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        data={results}
        keyExtractor={(item) => `${item.media_type}-${item.id}`}
        numColumns={3}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => <PosterCard item={item} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color="#fff" style={styles.spinner} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.hint}>
                {query.length >= 2
                  ? 'Sin resultados'
                  : 'Busca tus películas y series'}
              </Text>
            </View>
          )
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16 },
  column: { gap: 0, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 100, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 16 },
})
