import { ScrollView, View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { HeroCarousel } from '@/components/HeroCarousel'

export default function HomeScreen() {
  const { data, loading, error } = useAsync(() => tmdb.home())
  const { data: collections } = useAsync(() => tmdb.collections())

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
