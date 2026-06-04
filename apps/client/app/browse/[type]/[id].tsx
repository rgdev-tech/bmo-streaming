import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tmdb, backdropUrl, type MediaItem } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { RankedRow } from '@/components/RankedRow'
import { FeaturedCarousel } from '@/components/FeaturedCarousel'
import { BackdropRow } from '@/components/BackdropRow'

const { width } = Dimensions.get('window')
const HERO_H = width * 0.68

export default function BrowseScreen() {
  const router = useRouter()
  const { type, id, name } = useLocalSearchParams<{
    type: string
    id: string
    name: string
  }>()
  const insets = useSafeAreaInsets()
  const kind: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie'
  const { data, loading, error } = useAsync(() => tmdb.genre(kind, id!), [type, id])

  // Tag all items with the correct media_type
  const tag = (items: MediaItem[]): MediaItem[] =>
    items.map((i) => ({ ...i, media_type: kind }))
  const popular = tag(data?.popular ?? [])
  const topRated = tag(data?.topRated ?? [])
  const recent = tag(data?.recent ?? [])

  // Hero: primer item popular (backdrop distinto al carrusel)
  const heroItem = popular[0]
  const heroUrl = backdropUrl(heroItem?.backdrop_path ?? data?.hero ?? null, 'w1280')

  // Carrusel destacado: siguientes items con backdrop + overview (saltar el del hero)
  const carouselItems = popular
    .slice(1)
    .filter((i) => i.backdrop_path && i.overview)
    .slice(0, 6)

  // Populares: los que no están en el carrusel
  const carouselIds = new Set(carouselItems.map((i) => i.id))
  const popularRest = popular.filter((i) => i.id !== heroItem?.id && !carouselIds.has(i.id))

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* ── Hero ── */}
        <View style={{ height: HERO_H + insets.top }}>
          {heroUrl ? (
            <Image
              source={heroUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={400}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroPlaceholder]} />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.25)', 'transparent', 'rgba(0,0,0,0.98)']}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[styles.heroTitle, { bottom: 22 }]}>{name}</Text>
        </View>

        {/* ── Content ── */}
        {loading ? (
          <ActivityIndicator color="#fff" style={styles.spinner} />
        ) : error ? (
          <Text style={styles.errorText}>No se pudo cargar el contenido</Text>
        ) : (
          <View style={styles.sections}>

            {/* Destacado: carrusel swipeable */}
            {carouselItems.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Destacado</Text>
                <FeaturedCarousel items={carouselItems} />
              </View>
            )}

            {/* Populares: poster row */}
            {popularRest.length > 0 && (
              <PosterRow title="Populares" items={popularRest} />
            )}

            {/* Top 10: ranked */}
            {topRated.length > 0 && (
              <RankedRow title="Top 10" items={topRated} />
            )}

            {/* Recién llegados: landscape backdrop cards */}
            {recent.length > 0 && (
              <BackdropRow title="Recién llegados" items={recent} />
            )}

            {/* Más valorados: extra poster row from topRated tail */}
            {topRated.length > 10 && (
              <PosterRow title="Más valorados" items={topRated.slice(10)} />
            )}

          </View>
        )}
      </ScrollView>

      {/* ── Liquid glass back button ── */}
      <Pressable
        style={[styles.backBtn, { top: insets.top + 10 }]}
        onPress={() => router.back()}
        hitSlop={10}
      >
        <BlurView intensity={55} tint="dark" style={styles.blurWrap}>
          <SymbolView name="chevron.left" tintColor="#fff" style={styles.backIcon} />
        </BlurView>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  heroPlaceholder: { backgroundColor: '#1C1C1E' },
  heroTitle: {
    position: 'absolute',
    left: 18,
    right: 18,
    color: '#fff',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 12,
  },
  sections: { paddingTop: 20 },
  section: { marginBottom: 24 },
  sectionLabel: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  spinner: { marginTop: 60 },
  errorText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 60,
  },
  // Liquid glass button
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  blurWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { width: 15, height: 15 },
})
