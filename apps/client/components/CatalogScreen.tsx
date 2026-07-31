import { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from './PosterRow'
import { BackdropRow } from './BackdropRow'
import { RankedRow } from './RankedRow'
import { FeaturedCard } from './FeaturedCard'
import { FeaturedCarousel } from './FeaturedCarousel'
import { PosterCard } from './PosterCard'
import { Touchable } from './Touchable'
import { EmptyState } from './EmptyState'
import { CatalogSkeleton } from './Skeleton'
import { screenTitle, rowHeading } from '@/lib/typography'
import type { CatalogData, MediaItem } from '@/lib/tmdb'
import { colors } from '@/lib/theme'

const GRID_GAP = 12
const GRID_PAD = 20
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3
)

// Las filas de género rotan entre tres patrones visuales (en vez de alternar
// solo dos) — con ~12 géneros, dos patrones se volvían muy repetitivos.
const GENRE_PATTERNS = ['backdrop', 'poster', 'ranked'] as const

type Section =
  | { key: string; kind: 'featured'; item: MediaItem }
  | { key: string; kind: 'carousel'; title: string; items: MediaItem[] }
  | { key: string; kind: 'poster'; title: string; items: MediaItem[]; studioKey?: string }
  | { key: string; kind: 'backdrop'; title: string; items: MediaItem[] }
  | { key: string; kind: 'ranked'; title: string; items: MediaItem[] }

export function CatalogScreen({
  brand,
  kind,
  load,
}: {
  brand: string
  kind: 'movie' | 'tv'
  load: () => Promise<CatalogData>
}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { data, loading, error, refetch } = useAsync(load)
  const [genre, setGenre] = useState<string | null>(null)

  const shell = (inner: React.ReactNode, pad = false) => (
    <View style={[styles.root, pad && { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {inner}
    </View>
  )

  if (loading) return shell(<CatalogSkeleton />, true)
  if (error || !data) return shell(
    <View style={styles.fill}>
      <EmptyState
        icon="wifi.slash"
        title="No pude cargar el catálogo"
        subtitle="Revisa tu conexión e intenta de nuevo."
        action={{ label: 'Reintentar', onPress: refetch }}
      />
    </View>,
    true
  )

  const chips = [
    { key: 'all', label: 'Destacados' },
    ...data.genres.map((g) => ({ key: g.name, label: g.name })),
  ]
  const selected = genre
    ? data.genres.find((g) => g.name === genre)?.results ?? []
    : null

  const tag = (items: MediaItem[] = []): MediaItem[] =>
    items.map((i) => ({ ...i, media_type: kind } as MediaItem))

  // Item destacado: primer trending con arte y sinopsis
  const featured = data.trending.results.find((i) => i.backdrop_path && i.overview)
  const trending = tag(data.trending.results.filter((i) => i.id !== featured?.id))
  const topRated = tag(data.topRated.results)
  // `?.` en los campos nuevos: una API aún no desplegada no los trae (ver CatalogData)
  const popular = tag(data.popular?.results)
  const recent = tag(data.recent?.results)
  const classics = tag(data.classics?.results)
  const providers = data.providers ?? []

  // Carrusel: mejor valoradas con arte + sinopsis, sin repetir el destacado
  const carousel = topRated
    .filter((i) => i.backdrop_path && i.overview && i.id !== featured?.id)
    .slice(0, 6)

  const sections: Section[] = [
    ...(featured
      ? [{ key: 'featured', kind: 'featured', item: { ...featured, media_type: kind } } as Section]
      : []),
    { key: 'trending', kind: 'poster', title: 'Tendencias', items: trending },
    { key: 'top10', kind: 'ranked', title: 'Top 10', items: topRated },
    ...(popular.length
      ? [{ key: 'popular', kind: 'backdrop', title: 'Populares', items: popular } as Section]
      : []),
    ...(recent.length
      ? [{
          key: 'recent',
          kind: 'poster',
          title: kind === 'movie' ? 'Recién estrenadas' : 'Series nuevas',
          items: recent,
        } as Section]
      : []),
    ...(carousel.length
      ? [{ key: 'imperdibles', kind: 'carousel', title: 'Imperdibles', items: carousel } as Section]
      : []),
    // Filas por plataforma — el encabezado lleva al catálogo de esa marca
    ...providers.map((p) => ({
      key: `prov-${p.key}`,
      kind: 'poster' as const,
      title: `Lo mejor de ${p.name}`,
      items: tag(p.results),
      studioKey: p.key,
    })),
    ...(classics.length
      ? [{ key: 'classics', kind: 'ranked', title: 'Clásicos aclamados', items: classics } as Section]
      : []),
    ...data.genres.map((g, i) => ({
      key: `genre-${g.name}`,
      kind: GENRE_PATTERNS[i % GENRE_PATTERNS.length],
      title: g.name,
      items: tag(g.results),
    })),
    { key: 'best', kind: 'poster', title: 'Mejor valoradas', items: topRated.slice(10) },
  ]

  function renderSection(s: Section) {
    switch (s.kind) {
      case 'featured':
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Destacado</Text>
            <FeaturedCard item={s.item} />
          </View>
        )
      case 'carousel':
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <FeaturedCarousel items={s.items} />
          </View>
        )
      case 'backdrop':
        return <BackdropRow title={s.title} items={s.items} />
      case 'ranked':
        return <RankedRow title={s.title} items={s.items} />
      case 'poster':
        return (
          <PosterRow
            title={s.title}
            items={s.items}
            onPressTitle={
              s.studioKey ? () => router.push(`/studio/${s.studioKey}` as never) : undefined
            }
          />
        )
    }
  }

  const header = (
    <View style={styles.titleWrap}>
      <Text style={styles.bigTitle}>{brand}</Text>
    </View>
  )

  return shell(
    <>
      {selected ? (
        /* Vista filtrada por género: grid de posters */
        <FlatList
          key="grid"
          style={styles.container}
          data={selected}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          columnWrapperStyle={styles.gridCol}
          contentContainerStyle={[styles.gridContent, { paddingTop: insets.top + 64 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <PosterCard item={{ ...item, media_type: kind } as MediaItem} width={GRID_CARD} />
          )}
        />
      ) : (
        /* Vista general: secciones con patrones visuales variados.
           FlatList (no ScrollView): con ~20 filas, montarlas todas de una
           costaba caro — así solo se montan las visibles. */
        <FlatList
          key="sections"
          style={styles.container}
          data={sections}
          keyExtractor={(s) => s.key}
          renderItem={({ item }) => renderSection(item)}
          ListHeaderComponent={header}
          contentContainerStyle={[styles.rows, { paddingTop: insets.top + 64 }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={4}
          maxToRenderPerBatch={3}
          windowSize={7}
        />
      )}

      {/* Pill de categorías flotante: el contenido pasa edge-to-edge por detrás
          (sin banda negra arriba) y el pill se mantiene fijo bajo el status bar */}
      <View style={[styles.chipsBar, { top: insets.top }]} pointerEvents="box-none">
        <BlurView intensity={80} tint="systemChromeMaterialDark" style={styles.chipsPill}>
          <FlatList
            horizontal
            data={chips}
            keyExtractor={(c) => c.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            renderItem={({ item }) => {
              const active = (genre ?? 'all') === item.key
              return (
                <Touchable
                  scaleTo={0.94}
                  haptic="selection"
                  onPress={() => setGenre(item.key === 'all' ? null : item.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.label}
                  </Text>
                </Touchable>
              )
            }}
          />
        </BlurView>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  titleWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  bigTitle: screenTitle,

  chipsBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
  },
  chipsPill: {
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipsRow: { paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#000' },

  rows: { paddingTop: 12, paddingBottom: 120 },
  section: { marginBottom: 24 },
  sectionTitle: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },

  gridCol: { gap: GRID_GAP, paddingHorizontal: GRID_PAD, marginBottom: GRID_GAP },
  gridContent: { paddingBottom: 120 },
})
