import { useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { Stack } from 'expo-router'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from './PosterRow'
import { BackdropRow } from './BackdropRow'
import { RankedRow } from './RankedRow'
import { FeaturedCard } from './FeaturedCard'
import { PosterCard } from './PosterCard'
import { Touchable } from './Touchable'
import { EmptyState } from './EmptyState'
import { CatalogSkeleton } from './Skeleton'
import { screenTitle, rowHeading } from '@/lib/typography'
import type { CatalogData, MediaItem } from '@/lib/tmdb'

const GRID_GAP = 12
const GRID_PAD = 20
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3
)

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

  // Item destacado: primer trending con backdrop + overview
  const featured = data.trending.results.find((i) => i.backdrop_path && i.overview)
  const taggedTrending = data.trending.results
    .filter((i) => i.id !== featured?.id)
    .map((i) => ({ ...i, media_type: kind } as MediaItem))
  const taggedTopRated = data.topRated.results.map((i) => ({ ...i, media_type: kind } as MediaItem))

  return shell(
    <>
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 64 }}
    >
      {/* Título grande (scrollea por detrás del pill flotante) */}
      <View style={styles.titleWrap}>
        <Text style={styles.bigTitle}>{brand}</Text>
      </View>

      {/* contenido */}
      {selected ? (
        /* Vista filtrada por género: grid de posters */
        <View style={styles.grid}>
          {selected.map((item) => (
            <PosterCard
              key={item.id}
              item={{ ...item, media_type: kind } as MediaItem}
              width={GRID_CARD}
            />
          ))}
        </View>
      ) : (
        /* Vista general: patrones visuales variados */
        <View style={styles.rows}>

          {/* Destacado: tarjeta grande con descripción */}
          {featured && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Destacado</Text>
              <FeaturedCard item={{ ...featured, media_type: kind }} />
            </View>
          )}

          {/* Tendencias: fila de posters */}
          <PosterRow title="Tendencias" items={taggedTrending} />

          {/* Top 10: fila rankeada */}
          <RankedRow title="Top 10" items={taggedTopRated} />

          {/* Géneros: alternar BackdropRow y PosterRow */}
          {data.genres.map((g, i) => {
            const tagged = g.results.map((item) => ({ ...item, media_type: kind } as MediaItem))
            return i % 2 === 0
              ? <BackdropRow key={g.name} title={g.name} items={tagged} />
              : <PosterRow key={g.name} title={g.name} items={tagged} />
          })}

          {/* Mejor valoradas: otra fila rankeada al final */}
          <RankedRow title="Mejor valoradas" items={taggedTopRated.slice(10)} />

        </View>
      )}
    </ScrollView>

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
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipsRow: { paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#000' },

  rows: { paddingTop: 12, paddingBottom: 120 },
  section: { marginBottom: 24 },
  sectionTitle: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PAD,
    paddingTop: 12,
    paddingBottom: 120,
  },
})
