import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tmdb, backdropUrl, type MediaItem } from '@/lib/tmdb'
import { STUDIO_BRANDS } from '@/lib/studios'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { RankedRow } from '@/components/RankedRow'
import { FeaturedCarousel } from '@/components/FeaturedCarousel'
import { BackdropRow } from '@/components/BackdropRow'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonRow } from '@/components/Skeleton'
import { rowHeading } from '@/lib/typography'

const { width } = Dimensions.get('window')
const HERO_H = width * 0.62

export default function StudioScreen() {
  const router = useRouter()
  const { key } = useLocalSearchParams<{ key: string }>()
  const insets = useSafeAreaInsets()
  const { data, loading, error, refetch } = useAsync(() => tmdb.studio(key!), [key])

  const brand = STUDIO_BRANDS.find((b) => b.key === key)
  const kind: 'movie' | 'tv' = data?.type === 'tv' ? 'tv' : 'movie'

  // Todos los items de un catálogo de estudio son del mismo tipo (el discover
  // pide movie o tv, no mixto) — los etiquetamos para que las tarjetas naveguen
  // al detalle correcto.
  const tag = (items: MediaItem[]): MediaItem[] =>
    (items ?? []).map((i) => ({ ...i, media_type: kind }))
  const popular = tag(data?.popular ?? [])
  const topRated = tag(data?.topRated ?? [])
  const recent = tag(data?.recent ?? [])

  const heroItem = popular[0]
  const heroUrl = backdropUrl(heroItem?.backdrop_path ?? data?.hero ?? null, 'w1280')
  const brandName = data?.name ?? brand?.name ?? key

  const carouselItems = popular
    .slice(1)
    .filter((i) => i.backdrop_path && i.overview)
    .slice(0, 6)
  const carouselIds = new Set(carouselItems.map((i) => i.id))
  const popularRest = popular.filter((i) => i.id !== heroItem?.id && !carouselIds.has(i.id))

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* ── Hero con identidad de marca ── */}
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
          {/* Tinte del color de la marca sobre el backdrop */}
          <LinearGradient
            colors={[`${(brand?.colors[0] ?? '#000')}CC`, 'transparent', 'rgba(0,0,0,0.98)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroContent, { bottom: 22 }]}>
            <Text style={styles.heroKicker}>Catálogo</Text>
            <Text style={styles.heroTitle}>{brandName}</Text>
          </View>
        </View>

        {/* ── Contenido ── */}
        {loading ? (
          <View style={styles.skeletonRows}>
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <EmptyState
              icon="wifi.slash"
              title="No se pudo cargar el catálogo"
              subtitle="Revisa tu conexión e intenta de nuevo."
              action={{ label: 'Reintentar', onPress: refetch }}
            />
          </View>
        ) : (
          <View style={styles.sections}>
            {carouselItems.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Destacado</Text>
                <FeaturedCarousel items={carouselItems} />
              </View>
            )}
            {popularRest.length > 0 && (
              <PosterRow title="Populares" items={popularRest} />
            )}
            {topRated.length > 0 && (
              <RankedRow title="Top 10" items={topRated} />
            )}
            {recent.length > 0 && (
              <BackdropRow title="Recién llegados" items={recent} />
            )}
            {topRated.length > 10 && (
              <PosterRow title="Más valorados" items={topRated.slice(10)} />
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Botón volver liquid glass ── */}
      <Touchable
        scaleTo={0.88}
        haptic="light"
        style={[styles.backBtn, { top: insets.top + 10 }]}
        onPress={() => router.back()}
        hitSlop={10}
      >
        <BlurView intensity={55} tint="dark" style={styles.blurWrap}>
          <SymbolView name="chevron.left" tintColor="#fff" style={styles.backIcon} />
        </BlurView>
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  heroPlaceholder: { backgroundColor: '#1C1C1E' },
  heroContent: { position: 'absolute', left: 18, right: 18 },
  heroKicker: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 8,
  },
  heroTitle: {
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
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  skeletonRows: { paddingTop: 20, gap: 28 },
  errorBox: { paddingTop: 60, alignItems: 'center' },
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
  blurWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backIcon: { width: 15, height: 15 },
})
