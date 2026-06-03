import { useCallback, useState } from 'react'
import { ScrollView, View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { HeroCarousel } from '@/components/HeroCarousel'
import { ContinueRow } from '@/components/ContinueRow'
import { getContinueWatching, type Progress } from '@/lib/library'

export default function HomeScreen() {
  const { data, loading, error } = useAsync(() => tmdb.home())
  const { data: collections } = useAsync(() => tmdb.collections())

  const router = useRouter()

  // Se recarga al volver a la pestaña (refleja lo que acabas de ver)
  const [watching, setWatching] = useState<Progress[]>([])
  const loadWatching = useCallback(() => {
    getContinueWatching().then(setWatching)
  }, [])
  useFocusEffect(loadWatching)

  if (loading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    )
  }

  if (error || !data) {
    return (
      <View style={styles.fill}>
        <Text style={styles.error}>No pude cargar el catálogo.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <HeroCarousel items={data.trending.results} />

      <View style={styles.rows}>
        <ContinueRow
          items={watching}
          onChange={loadWatching}
          onSeeAll={() => router.navigate('/library')}
        />
        <PosterRow title="Tendencias" items={data.trending.results} />

        {collections && (
          <>
            <PosterRow title="Lo mejor de Netflix" items={collections.netflix.results} />
            <PosterRow title="Lo mejor de Apple TV+" items={collections.appletv.results} />
            <PosterRow title="Lo mejor de HBO Max" items={collections.hbo.results} />
            <PosterRow title="Lo mejor de Disney+" items={collections.disney.results} />
            <PosterRow title="Lo mejor de Prime Video" items={collections.prime.results} />
          </>
        )}

        <PosterRow title="Películas populares" items={data.popularMovies.results} />
        <PosterRow title="Series populares" items={data.popularSeries.results} />
        <PosterRow title="Mejor valoradas" items={data.topMovies.results} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  rows: { paddingTop: 20, paddingBottom: 20 },
  error: { color: '#FF6B6B', fontSize: 15 },
})
