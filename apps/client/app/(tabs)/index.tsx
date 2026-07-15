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

export default function HomeScreen() {
  const router = useRouter()
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
  const trendingRest = spotlight
    ? data.trending.results.filter((i) => i.id !== spotlight.id)
    : data.trending.results

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
          <ContinueRow
            items={watching}
            onChange={loadWatching}
            onSeeAll={() => router.navigate('/library')}
          />

          {/* Tendencias: fila de posters */}
          <PosterRow title="Tendencias" items={trendingRest} />

          {/* Spotlight: tarjeta grande con descripción */}
          {spotlight && (
            <View style={styles.featuredWrap}>
              <Text style={styles.rowTitle}>Destacado hoy</Text>
              <FeaturedCard item={spotlight} />
            </View>
          )}

          {/* Top 10: fila rankeada */}
          <RankedRow title="Top 10 películas" items={data.topMovies.results} />

          {collections && (
            <>
              {/* Netflix: posters */}
              <PosterRow title="Lo mejor de Netflix" items={collections.netflix.results} />

              {/* HBO: landscape backdrops */}
              <BackdropRow title="Lo mejor de HBO Max" items={collections.hbo.results} />

              {/* Apple TV+: posters */}
              <PosterRow title="Lo mejor de Apple TV+" items={collections.appletv.results} />

              {/* Disney+: landscape backdrops */}
              <BackdropRow title="Lo mejor de Disney+" items={collections.disney.results} />

              {/* Prime: posters */}
              <PosterRow title="Lo mejor de Prime Video" items={collections.prime.results} />
            </>
          )}

          {/* Películas populares: posters */}
          <PosterRow title="Películas populares" items={data.popularMovies.results} />

          {/* Series del momento: rankeadas */}
          <RankedRow title="Series del momento" items={data.popularSeries.results} />

          {/* Mejor valoradas: landscape backdrops */}
          <BackdropRow title="Mejor valoradas" items={data.topMovies.results} />
        </View>
      </Animated.ScrollView>

      {/* Header overlay que se desvanece al hacer scroll */}
      <Animated.View
        style={[styles.header, { top: insets.top + 4, opacity: headerOpacity }]}
        pointerEvents="box-none"
      >
        <Text style={styles.headerTitle}>Inicio</Text>
        <Touchable scaleTo={0.9} haptic="light" style={styles.avatar}>
          <SymbolView name="person.fill" tintColor="rgba(255,255,255,0.9)" style={styles.avatarIcon} />
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
