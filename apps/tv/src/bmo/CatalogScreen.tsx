import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { tmdb, type CatalogData, type MediaItem } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { HeroCarousel, HERO_ITEMS } from './HeroCarousel'
import { PosterRow } from './PosterRow'
import { RankedRow } from './RankedRow'
import { BackdropRow } from './BackdropRow'
import { RowsList, type RowSection } from './RowsList'
import { FocusButton } from './FocusButton'
import { colors, rowHeading } from './theme'

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
  const { data, loading, error, refetch } = useAsync<CatalogData>(
    () => (kind === 'movies' ? tmdb.movies() : tmdb.series()),
    [kind],
    `catalog:${kind}`
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
        <Text style={styles.errorHint}>Revisá tu conexión a internet e intentá de nuevo.</Text>
        <FocusButton label="Reintentar" primary hasTVPreferredFocus onPress={refetch} />
      </View>
    )
  }

  // Mismo criterio que la home: lo que rota arriba no se repite en la fila.
  const heroIds = new Set(
    data.trending.results
      .filter((i) => i.backdrop_path && i.overview)
      .slice(0, HERO_ITEMS)
      .map((i) => i.id)
  )
  const trendingRest = data.trending.results.filter((i) => !heroIds.has(i.id))

  // Formatos intercalados (póster grande → Top 10 → apaisada → póster…) como
  // secciones de la lista virtualizada, para que la pantalla no sea la misma
  // tarjeta repetida hacia abajo. Solo se incluye lo que tiene contenido.
  const sections: RowSection[] = [
    { key: 'tendencias', node: <PosterRow title="Tendencias" items={trendingRest} onPressItem={openTitle} size="large" /> },
    { key: 'top10', node: <RankedRow title={`Top 10 en ${kind === 'movies' ? 'películas' : 'series'}`} items={data.popular.results} onPressItem={openTitle} /> },
    { key: 'toprated', node: <BackdropRow title="Mejor valoradas" items={data.topRated.results} onPressItem={openTitle} /> },
  ]
  if (data.recent?.results?.length) {
    sections.push({ key: 'recent', node: <PosterRow title="Novedades" items={data.recent.results} onPressItem={openTitle} /> })
  }
  if (data.classics?.results?.length) {
    sections.push({ key: 'classics', node: <BackdropRow title="Clásicos" items={data.classics.results} onPressItem={openTitle} /> })
  }
  // Filas por género. Cada tercera va apaisada para seguir cortando el ritmo.
  data.genres?.forEach((g, i) => {
    sections.push({
      key: `genre-${g.name}`,
      node: i % 3 === 2
        ? <BackdropRow title={g.name} items={g.results} onPressItem={openTitle} />
        : <PosterRow title={g.name} items={g.results} onPressItem={openTitle} />,
    })
  })

  return (
    <View style={styles.container}>
      <RowsList header={<HeroCarousel items={data.trending.results} />} sections={sections} />
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
