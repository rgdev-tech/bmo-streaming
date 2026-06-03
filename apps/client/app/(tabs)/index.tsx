import { useCallback, useRef, useState } from 'react'
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  Animated,
  Pressable,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { tmdb } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { HeroCarousel } from '@/components/HeroCarousel'
import { ContinueRow } from '@/components/ContinueRow'
import { getContinueWatching, type Progress } from '@/lib/library'

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current

  const { data, loading, error } = useAsync(() => tmdb.home())
  const { data: collections } = useAsync(() => tmdb.collections())

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

  // El header "Inicio" + avatar se desvanece al hacer scroll
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 180],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })

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
      </Animated.ScrollView>

      {/* Header overlay */}
      <Animated.View
        style={[styles.header, { top: insets.top + 4, opacity: headerOpacity }]}
        pointerEvents="box-none"
      >
        <Text style={styles.headerTitle}>Inicio</Text>
        <Pressable style={styles.avatar}>
          <SymbolView name="person.fill" tintColor="rgba(255,255,255,0.9)" style={styles.avatarIcon} />
        </Pressable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  rows: { paddingTop: 16, paddingBottom: 20 },
  error: { color: '#FF6B6B', fontSize: 15 },
  header: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
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
