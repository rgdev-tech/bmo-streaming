import { useCallback, useRef, useState } from 'react'
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  Animated,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { BackdropRow } from '@/components/BackdropRow'
import { RankedRow } from '@/components/RankedRow'
import { FeaturedCard } from '@/components/FeaturedCard'
import { HeroCarousel } from '@/components/HeroCarousel'
import { ContinueRow } from '@/components/ContinueRow'
import { HomeSkeleton } from '@/components/Skeleton'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { screenTitle, rowHeading } from '@/lib/typography'
import { getContinueWatching, type Progress } from '@/lib/library'
import { useAuth } from '@/lib/auth'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { dedupeRows, heroIds } from '@/lib/dedupeRows'
import { Reveal } from '@/components/Reveal'
import { colors } from '@/lib/theme'

// Cuántos títulos rota el hero. Tiene que coincidir con MAX_ITEMS de
// HeroCarousel: es la lista que se excluye del resto del Home.
const HERO_ITEMS = 6

export default function HomeScreen() {
  const router = useRouter()
  const { profile } = useAuth()
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current

  const { data, loading, error, refetch } = useAsync(() => tmdb.home())
  const { data: collections } = useAsync(() => tmdb.collections())

  const [watching, setWatching] = useState<Progress[]>([])
  const loadWatching = useCallback(() => {
    getContinueWatching().then(setWatching)
  }, [])
  useFocusEffect(loadWatching)

  if (loading) {
    return <HomeSkeleton />
  }
  if (error || !data) {
    return (
      <View style={styles.fill}>
        <EmptyState
          icon="wifi.slash"
          title="No pude cargar el catálogo"
          subtitle="Revisa tu conexión e intenta de nuevo."
          action={{ label: 'Reintentar', onPress: refetch }}
        />
      </View>
    )
  }

  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 180],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })

  // Item destacado: primer trending con backdrop + overview
  const spotlight = data.trending.results.find((i) => i.backdrop_path && i.overview)

  // El Home mezcla fuentes que se solapan mucho (lo que es tendencia también es
  // popular, y lo popular suele estar en Netflix): medido contra la API real,
  // el 26% de las tarjetas eran un título ya visto más arriba. Se reparte una
  // sola vez cada título, respetando el orden de las filas como prioridad.
  const rows = dedupeRows(
    [
      { key: 'trending', items: data.trending.results },
      { key: 'topMovies', items: data.topMovies.results },
      ...(collections
        ? [
            { key: 'netflix', items: collections.netflix.results },
            { key: 'hbo', items: collections.hbo.results },
            { key: 'appletv', items: collections.appletv.results },
            { key: 'disney', items: collections.disney.results },
            { key: 'prime', items: collections.prime.results },
          ]
        : []),
      { key: 'popularMovies', items: data.popularMovies.results },
      { key: 'popularSeries', items: data.popularSeries.results },
      // Series mejor valoradas: fuente propia. Antes esta fila reusaba
      // data.topMovies —el mismo array que 'Top 10 películas'— así que las
      // dos mostraban lo mismo con distinto título.
      { key: 'topSeries', items: data.topSeries?.results ?? [] },
    ],
    {
      // El hero y el destacado ya ocupan la parte alta de la pantalla: volver a
      // verlos en una fila unos centímetros más abajo es la repetición más
      // evidente de todas.
      exclude: [
        ...heroIds(data.trending.results, HERO_ITEMS),
        ...(spotlight ? [spotlight.id] : []),
      ],
    }
  )

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <HeroCarousel items={data.trending.results} scrollY={scrollY} />

        <View style={styles.rows}>
          {/* Continuar viendo */}
          <Reveal index={0}>
            <ContinueRow
              items={watching}
              onChange={loadWatching}
              onSeeAll={() => router.navigate('/library')}
            />
          </Reveal>

          {/* Tendencias: fila de posters */}
          <Reveal index={1}><PosterRow title="Tendencias" items={rows.trending} /></Reveal>

          {/* Spotlight: tarjeta grande con descripción */}
          {spotlight && (
            <Reveal index={2}>
              <View style={styles.featuredWrap}>
                <Text style={styles.rowTitle}>Destacado hoy</Text>
                <FeaturedCard item={spotlight} />
              </View>
            </Reveal>
          )}

          {/* Top 10: fila rankeada */}
          <Reveal index={2}><RankedRow title="Top 10 películas" items={rows.topMovies} /></Reveal>

          {collections && (
            <>
              {/* Netflix: posters */}
              <Reveal index={3}><PosterRow title="Lo mejor de Netflix" items={rows.netflix} /></Reveal>

              {/* HBO: landscape backdrops */}
              <Reveal index={4}><BackdropRow title="Lo mejor de HBO Max" items={rows.hbo} /></Reveal>

              {/* Apple TV+: posters */}
              <Reveal index={5}><PosterRow title="Lo mejor de Apple TV+" items={rows.appletv} /></Reveal>

              {/* Disney+: landscape backdrops */}
              <Reveal index={6}><BackdropRow title="Lo mejor de Disney+" items={rows.disney} /></Reveal>

              {/* Prime: posters */}
              <Reveal index={7}><PosterRow title="Lo mejor de Prime Video" items={rows.prime} /></Reveal>
            </>
          )}

          {/* Películas populares: posters */}
          <Reveal index={8}><PosterRow title="Películas populares" items={rows.popularMovies} /></Reveal>

          {/* Series del momento: rankeadas */}
          <Reveal index={9}><RankedRow title="Series del momento" items={rows.popularSeries} /></Reveal>

          {/* Series mejor valoradas. Si la API todavía no manda topSeries
              (deploy desfasado), la fila no se dibuja en vez de repetir. */}
          {rows.topSeries.length > 0 && (
            <Reveal index={10}><BackdropRow title="Series mejor valoradas" items={rows.topSeries} /></Reveal>
          )}
        </View>
      </Animated.ScrollView>

      {/* Header overlay que se desvanece al hacer scroll */}
      <Animated.View
        style={[styles.header, { top: insets.top + 4, opacity: headerOpacity }]}
        pointerEvents="box-none"
      >
        <Text style={styles.headerTitle}>Inicio</Text>
        {/* Avatar → selector de perfiles. Muestra el emoji del perfil activo
            en vez del icono genérico cuando hay sesión. */}
        <Touchable
          scaleTo={0.9}
          haptic="light"
          style={styles.avatar}
          onPress={() => router.push('/profiles' as never)}
        >
          {profile ? (
            <ProfileAvatar avatar={profile.avatar} size={36} />
          ) : (
            <SymbolView name="person.fill" tintColor={colors.text} style={styles.avatarIcon} />
          )}
        </Touchable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  rows: { paddingTop: 16, paddingBottom: 90 },
  featuredWrap: { marginBottom: 24 },
  rowTitle: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  header: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    ...screenTitle,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(120,120,128,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: { width: 22, height: 22 },
})
