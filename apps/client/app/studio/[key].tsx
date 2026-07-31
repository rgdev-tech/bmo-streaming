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
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const HERO_H = width * 0.62

export default function StudioScreen() {
  const router = useRouter()
  const { key } = useLocalSearchParams<{ key: string }>()
  const insets = useSafeAreaInsets()
  const { data, loading, error, refetch } = useAsync(() => tmdb.studio(key!), [key])

  const brand = STUDIO_BRANDS.find((b) => b.key === key)
  // `primary` = tipo que luce la marca (hero/carrusel). Se cae a `type` legacy.
  const primary: 'movie' | 'tv' =
    data?.primary === 'tv' || (data?.primary == null && data?.type === 'tv') ? 'tv' : 'movie'

  // Catálogo DUAL: cada array se etiqueta con su media_type correcto para que la
  // tarjeta navegue al detalle bien (movie vs tv). Fallback a la forma legacy
  // (popular/topRated) por si la API es vieja: ahí todo es del tipo primario.
  const tagAs = (items: MediaItem[] | undefined, k: 'movie' | 'tv'): MediaItem[] =>
    (items ?? []).map((i) => ({ ...i, media_type: k }))
  const movies = tagAs(data?.movies ?? (primary === 'movie' ? data?.popular : []), 'movie')
  const moviesTop = tagAs(data?.moviesTop ?? (primary === 'movie' ? data?.topRated : []), 'movie')
  const series = tagAs(data?.series ?? (primary === 'tv' ? data?.popular : []), 'tv')
  const seriesTop = tagAs(data?.seriesTop ?? (primary === 'tv' ? data?.topRated : []), 'tv')
  const recent = tagAs(data?.recent, primary)

  const brandName = data?.name ?? brand?.name ?? key

  // Hero + carrusel salen del tipo primario; el top también.
  const primaryPop = primary === 'movie' ? movies : series
  const primaryTop = primary === 'movie' ? moviesTop : seriesTop
  const heroItem = primaryPop[0]
  const heroUrl = backdropUrl(heroItem?.backdrop_path ?? data?.hero ?? null, 'w1280')

  const carouselItems = primaryPop
    .slice(1)
    .filter((i) => i.backdrop_path && i.overview)
    .slice(0, 6)
  const usedIds = new Set<number>([heroItem?.id, ...carouselItems.map((i) => i.id)].filter(Boolean) as number[])
  // El tipo primario ya gastó hero+carrusel; quítalos de su fila. El secundario
  // se muestra completo.
  const moviesRow = primary === 'movie' ? movies.filter((i) => !usedIds.has(i.id)) : movies
  const seriesRow = primary === 'tv' ? series.filter((i) => !usedIds.has(i.id)) : series

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
            {/* Filas de pelis y series — la del tipo primario va primero. */}
            {primary === 'tv' ? (
              <>
                {seriesRow.length > 0 && <PosterRow title="Series" items={seriesRow} />}
                {moviesRow.length > 0 && <PosterRow title="Películas" items={moviesRow} />}
              </>
            ) : (
              <>
                {moviesRow.length > 0 && <PosterRow title="Películas" items={moviesRow} />}
                {seriesRow.length > 0 && <PosterRow title="Series" items={seriesRow} />}
              </>
            )}
            {primaryTop.length > 0 && (
              <RankedRow title="Top 10" items={primaryTop.slice(0, 10)} />
            )}
            {recent.length > 0 && (
              <BackdropRow title="Recién llegados" items={recent} />
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
  heroPlaceholder: { backgroundColor: colors.surface },
  heroContent: { position: 'absolute', left: 18, right: 18 },
  heroKicker: {
    color: colors.textDim,
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
    borderColor: colors.textFaint,
  },
  blurWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backIcon: { width: 15, height: 15 },
})
