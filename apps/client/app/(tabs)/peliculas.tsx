import { ScrollView, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'

export default function PeliculasScreen() {
  const { data, loading, error } = useAsync(() => tmdb.movies())

  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>Películas</Text>

      {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}
      {error && <Text style={styles.error}>No pude cargar las películas.</Text>}

      {data && (
        <>
          <PosterRow title="Populares" items={data.popular.results} />
          <PosterRow title="Mejor valoradas" items={data.topRated.results} />
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  spinner: { marginTop: 60 },
  error: { color: '#FF6B6B', textAlign: 'center', marginTop: 40 },
})
