import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { tmdb, type CatalogData, type MediaItem } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { Hero } from './Hero'
import { PosterRow } from './PosterRow'
import { colors, rowHeading, safe, screenTitle } from './theme'

/**
 * Pantalla de catálogo, compartida por Películas y Series. Las dos consumen la
 * misma forma (`CatalogData`) y solo cambian el endpoint y el título, así que
 * duplicarlas sería copiar cien líneas para cambiar dos palabras.
 */
export function CatalogScreen({
  title,
  kind,
}: {
  title: string
  kind: 'movies' | 'series'
}) {
  const router = useRouter()
  const { data, loading, error } = useAsync<CatalogData>(
    () => (kind === 'movies' ? tmdb.movies() : tmdb.series()),
    [kind]
  )

  function openTitle(item: MediaItem) {
    const t = kind === 'series' || item.media_type === 'tv' || (!!item.name && !item.title)
      ? 'tv'
      : 'movie'
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
        <Text style={styles.errorTitle}>No pude cargar {title.toLowerCase()}</Text>
        <Text style={styles.errorHint}>Verificá que el API esté corriendo: bun run dev:api</Text>
      </View>
    )
  }

  const spotlight = data.trending.results.find((i) => i.backdrop_path && i.overview)
  const trendingRest = spotlight
    ? data.trending.results.filter((i) => i.id !== spotlight.id)
    : data.trending.results

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {spotlight && <Hero item={spotlight} />}

        <PosterRow title="Tendencias" items={trendingRest} onPressItem={openTitle} />
        <PosterRow title="Populares" items={data.popular.results} onPressItem={openTitle} />
        <PosterRow title="Mejor valoradas" items={data.topRated.results} onPressItem={openTitle} />
        {!!data.recent?.results?.length && (
          <PosterRow title="Novedades" items={data.recent.results} onPressItem={openTitle} />
        )}
        {!!data.classics?.results?.length && (
          <PosterRow title="Clásicos" items={data.classics.results} onPressItem={openTitle} />
        )}

        {/* Filas por género. Vienen del API ya agrupadas. */}
        {data.genres?.map((g) => (
          <PosterRow key={g.name} title={g.name} items={g.results} onPressItem={openTitle} />
        ))}
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
