import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { tmdb, type MediaItem } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { Hero } from '@/bmo/Hero'
import { PosterRow } from '@/bmo/PosterRow'
import { colors, rowHeading, safe, screenTitle } from '@/bmo/theme'

export default function HomeScreen() {
  const router = useRouter()
  const { data, loading, error } = useAsync(() => tmdb.home())

  // TMDB marca el tipo con media_type solo en trending; en las listas de
  // películas/series viene ausente, así que se deduce por la forma del item
  // (las series traen `name`, las películas `title`).
  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.push(`/title/${t}/${item.id}`)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    )
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>No pude cargar el catálogo</Text>
        <Text style={styles.errorHint}>
          Verificá que el API esté corriendo: bun run dev:api
        </Text>
      </View>
    )
  }

  // Mismo criterio que el cliente: el destacado es el primer trending que tenga
  // backdrop y sinopsis, y se saca de la fila para no repetirlo justo debajo.
  const spotlight = data.trending.results.find((i) => i.backdrop_path && i.overview)
  const trendingRest = spotlight
    ? data.trending.results.filter((i) => i.id !== spotlight.id)
    : data.trending.results

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {spotlight && <Hero item={spotlight} />}

        {/* Sin título de pantalla: la barra de navegación ya marca la sección
            activa, así que un "Inicio" en grande sería la misma información dos
            veces. El teléfono sí lo lleva porque allá no hay barra visible. */}

        <PosterRow title="Tendencias" items={trendingRest} onPressItem={openTitle} />
        <PosterRow title="Películas populares" items={data.popularMovies.results} onPressItem={openTitle} />
        <PosterRow title="Series del momento" items={data.popularSeries.results} onPressItem={openTitle} />
        <PosterRow title="Mejor valoradas" items={data.topMovies.results} onPressItem={openTitle} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorTitle: rowHeading,
  errorHint: { fontSize: 14, color: colors.textDim },
})
