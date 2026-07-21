import { useCallback, useRef } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { tmdb, type MediaItem } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { HeroCarousel, HERO_ITEMS } from '@/bmo/HeroCarousel'
import { PosterRow } from '@/bmo/PosterRow'
import { RankedRow } from '@/bmo/RankedRow'
import { BackdropRow } from '@/bmo/BackdropRow'
import { RowScrollContext, ROW_SCROLL_TOP_INSET } from '@/bmo/RowScrollContext'
import { colors, rowHeading, safe } from '@/bmo/theme'

export default function HomeScreen() {
  const router = useRouter()
  const scrollRef = useRef<ScrollView>(null)
  // Lleva la fila enfocada a una altura fija (como Apple TV), en vez de dejar que
  // el auto-scroll nativo la empuje contra el borde inferior con pósters cortados.
  const scrollRowIntoView = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - ROW_SCROLL_TOP_INSET), animated: true })
  }, [])
  const { data, loading, error } = useAsync(() => tmdb.home())
  // Las colecciones por plataforma van en su propia petición: son lentas y no
  // deben frenar el primer pintado. La home ya se ve mientras estas llegan.
  const { data: collections } = useAsync(() => tmdb.collections())

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

  // Los títulos que rotan arriba se sacan de la fila: tenerlos en el hero y a
  // treinta píxeles en "Tendencias" hace que el catálogo parezca más chico de lo
  // que es. El criterio para entrar al carrusel (backdrop + sinopsis) tiene que
  // ser el mismo que usa HeroCarousel, si no los conjuntos no coinciden.
  const heroIds = new Set(
    data.trending.results
      .filter((i) => i.backdrop_path && i.overview)
      .slice(0, HERO_ITEMS)
      .map((i) => i.id)
  )
  const trendingRest = data.trending.results.filter((i) => !heroIds.has(i.id))

  return (
    <View style={styles.container}>
      <RowScrollContext.Provider value={scrollRowIntoView}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        <HeroCarousel items={data.trending.results} />

        {/* Sin título de pantalla: el rail ya marca la sección activa, así que
            un "Inicio" en grande sería la misma información dos veces.

            El orden de las filas no es casual. Alterna formatos (póster →
            ranking → apaisada) para que el ojo tenga puntos de referencia al
            bajar, y pone lo más fuerte arriba: Tendencias y Top 10 son lo que
            decide si el usuario se queda. */}
        <PosterRow title="Tendencias" items={trendingRest} onPressItem={openTitle} />

        <RankedRow title="Top 10 películas" items={data.topMovies.results} onPressItem={openTitle} />

        {collections && (
          <PosterRow title="Lo mejor de Netflix" items={collections.netflix.results} onPressItem={openTitle} />
        )}

        <BackdropRow title="Series del momento" items={data.popularSeries.results} onPressItem={openTitle} />

        {collections && (
          <>
            <PosterRow title="Lo mejor de HBO Max" items={collections.hbo.results} onPressItem={openTitle} />
            <BackdropRow title="Lo mejor de Apple TV+" items={collections.appletv.results} onPressItem={openTitle} />
            <PosterRow title="Lo mejor de Disney+" items={collections.disney.results} onPressItem={openTitle} />
            <PosterRow title="Lo mejor de Prime Video" items={collections.prime.results} onPressItem={openTitle} />
          </>
        )}

        <PosterRow title="Películas populares" items={data.popularMovies.results} onPressItem={openTitle} />

        <BackdropRow title="Mejor valoradas" items={data.topMovies.results} onPressItem={openTitle} />

        {/* Aire al final: sin esto la última fila queda pegada al borde inferior
            y al enfocarla el scroll no tiene hacia dónde correrse. */}
        <View style={styles.tail} />
      </ScrollView>
      </RowScrollContext.Provider>
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
  // Alto para que la última fila también pueda subir a la altura fija del foco
  // (si no, no habría contenido debajo hacia donde correr el scroll).
  tail: { height: safe.bottom + 320 },
  errorTitle: rowHeading,
  errorHint: { fontSize: 14, color: colors.textDim },
})
