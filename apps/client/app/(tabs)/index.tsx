import { ScrollView, Text, View, ActivityIndicator, StyleSheet } from 'react-native'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'

export default function HomeScreen() {
  const { data, loading, error } = useAsync(() => tmdb.home())

  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.hero}>
        <Text style={styles.logo}>BMO</Text>
        <Text style={styles.tagline}>Tu streaming, sin ruido.</Text>
      </View>

      {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}
      {error && <Text style={styles.error}>No pude cargar el catálogo.{'\n'}{error}</Text>}

      {data && (
        <>
          <PosterRow title="Tendencias" items={data.trending.results} />
          <PosterRow title="Películas populares" items={data.popularMovies.results} />
          <PosterRow title="Series populares" items={data.popularSeries.results} />
          <PosterRow title="Mejor valoradas" items={data.topMovies.results} />
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  hero: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 24 },
  logo: { fontSize: 44, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  tagline: { fontSize: 17, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  spinner: { marginTop: 60 },
  error: { color: '#FF6B6B', textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
})
