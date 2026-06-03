import { useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { Stack } from 'expo-router'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from './PosterRow'
import { PosterCard } from './PosterCard'
import type { CatalogData, MediaItem } from '@/lib/tmdb'

const GRID_GAP = 12
const GRID_PAD = 20
// Math.floor para dejar holgura: si da exacto, el subpíxel desborda la 3ª columna
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
  const { data, loading, error } = useAsync(load)
  const [genre, setGenre] = useState<string | null>(null)

  const shell = (inner: React.ReactNode) => (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {inner}
    </View>
  )

  if (loading) {
    return shell(
      <View style={styles.fill}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    )
  }

  if (error || !data) {
    return shell(
      <View style={styles.fill}>
        <Text style={styles.error}>No pude cargar el catálogo.</Text>
      </View>
    )
  }

  const chips = [
    { key: 'all', label: 'Destacados' },
    ...data.genres.map((g) => ({ key: g.name, label: g.name })),
  ]
  const selected = genre
    ? data.genres.find((g) => g.name === genre)?.results ?? []
    : null

  return shell(
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={[1]}
    >
      {/* índice 0: título grande, se va con el scroll */}
      <View style={styles.titleWrap}>
        <Text style={styles.bigTitle}>{brand}</Text>
      </View>

      {/* índice 1: pill flotante de vidrio, se queda pineada (bajo el notch) */}
      <View style={styles.chipsBar}>
        <BlurView intensity={80} tint="systemChromeMaterialDark" style={styles.pill}>
          <FlatList
            horizontal
            data={chips}
            keyExtractor={(c) => c.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            renderItem={({ item }) => {
              const active = (genre ?? 'all') === item.key
              return (
                <Pressable
                  onPress={() => setGenre(item.key === 'all' ? null : item.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              )
            }}
          />
        </BlurView>
      </View>

      {/* índice 2: contenido */}
      {selected ? (
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
        <View style={styles.rows}>
          <PosterRow title="Tendencias" items={data.trending.results} />
          {data.genres.map((g) => (
            <PosterRow key={g.name} title={g.name} items={g.results} />
          ))}
          <PosterRow title="Mejor valoradas" items={data.topRated.results} />
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF6B6B', fontSize: 15 },
  titleWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  bigTitle: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  chipsBar: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  pill: {
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipsRow: { paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  rows: { paddingTop: 12, paddingBottom: 120 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PAD,
    paddingTop: 12,
    paddingBottom: 120,
  },
})
