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
import { matchStudio, type StudioBrand } from '@/lib/studios'
import { useAsync } from '@/lib/useAsync'
import { PosterCard } from '@/components/PosterCard'
import { CategoryCard } from '@/components/CategoryCard'
import { PersonResultCard } from '@/components/PersonResultCard'
import { StudioBanner } from '@/components/StudioBanner'
import { EmptyState } from '@/components/EmptyState'

const { width } = Dimensions.get('window')
const CAT_W = Math.floor((width - 32 - 24) / 3)
const RES_W = CAT_W

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [people, setPeople] = useState<MediaItem[]>([])
  const [brand, setBrand] = useState<StudioBrand | null>(null)
  const [loading, setLoading] = useState(false)
  const { data: categories } = useAsync(() => tmdb.categories())

  const searching = query.trim().length >= 2

  async function runSearch(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); setPeople([]); setBrand(null); return }
    // Marca reconocida (Disney, HBO...) → banner de catálogo especial. Es local
    // e instantáneo, no espera a la red.
    setBrand(matchStudio(q))
    setLoading(true)
    try {
      const data = await tmdb.search(q)
      // Títulos (con póster) por un lado; personas (actores, con foto y
      // filmografía conocida) por otro — cada uno se muestra distinto.
      setResults(data.results.filter((r) => r.media_type !== 'person' && r.poster_path))
      setPeople(
        data.results
          .filter((r) => r.media_type === 'person' && r.profile_path)
          .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
          .slice(0, 3)
      )
    } catch { setResults([]); setPeople([]) }
    finally { setLoading(false) }
  }

  // Cabecera de resultados: banner de marca + personas encontradas, encima de
  // la cuadrícula de títulos.
  const hasExtras = !!brand || people.length > 0
  const Header = searching && hasExtras ? (
    <View style={styles.header}>
      {brand && <StudioBanner brand={brand} />}
      {people.length > 0 && (
        <View style={styles.peopleSection}>
          <Text style={styles.sectionLabel}>Personas</Text>
          <View style={styles.peopleList}>
            {people.map((p) => <PersonResultCard key={p.id} person={p} />)}
          </View>
        </View>
      )}
      {results.length > 0 && <Text style={styles.sectionLabel}>Títulos</Text>}
    </View>
  ) : null

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerSearchBarOptions: {
            placeholder: 'Películas, series, actores...',
            onChangeText: (e: any) => runSearch(e.nativeEvent.text),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
            textColor: '#fff',
            tintColor: '#fff',
            hintTextColor: 'rgba(255,255,255,0.45)',
          },
        }}
      />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={searching ? results : (categories ?? [])}
        keyExtractor={(item: any) =>
          searching
            ? `${item.media_type}-${item.id}`
            : `${item.type}-${item.genreId}`
        }
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={Header}
        renderItem={({ item }: any) =>
          searching
            ? <PosterCard item={item} width={RES_W} />
            : <CategoryCard cat={item} width={CAT_W} />
        }
        ListEmptyComponent={
          searching && loading
            ? <ActivityIndicator color="#fff" style={styles.spinner} />
            : searching
            ? (
              // Si hay banner de marca o personas, no mostramos "sin resultados"
              // (el usuario sí encontró algo, solo que no títulos).
              hasExtras ? null : (
                <View style={styles.empty}>
                  <EmptyState
                    icon="magnifyingglass"
                    title="Sin resultados"
                    subtitle="Prueba con otro título, actor o género."
                  />
                </View>
              )
            )
            : <ActivityIndicator color="#fff" style={styles.spinner} />
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#000' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 },
  col: { gap: 12, marginBottom: 12, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 80, alignItems: 'center' },
  header: { marginBottom: 12, gap: 20 },
  peopleSection: { gap: 10 },
  peopleList: { gap: 8 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
})
