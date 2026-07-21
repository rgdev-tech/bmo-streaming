import { Animated, FlatList, Pressable, StyleSheet, Text, TVFocusGuideView, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { backdropUrl, posterUrl } from '@bmo/core/tmdb'
import type { Progress } from '@bmo/core/library'
import { useFocusScale } from './useFocusScale'
import { useRowFocusScroll } from './useRowFocusScroll'
import { useRowScroll } from './RowScrollContext'
import { colors, layout, rowHeading, safe } from './theme'

function ContinueCard({
  item,
  onPress,
  onFocus,
}: {
  item: Progress
  onPress: (p: Progress) => void
  onFocus?: () => void
}) {
  const { scale, onFocus: onScaleFocus, onBlur } = useFocusScale(1.05)
  const uri = backdropUrl(item.backdrop_path, 'w780') ?? posterUrl(item.poster_path, 'w500')

  // La duración puede venir en 0 si el reproductor guardó antes de conocerla;
  // sin este resguardo la barra saldría con NaN de ancho y no se dibujaría.
  const pct = item.duration > 0 ? Math.min(1, item.position / item.duration) : 0
  const left = Math.max(0, Math.round((item.duration - item.position) / 60))

  return (
    <Pressable onFocus={() => { onScaleFocus(); onFocus?.() }} onBlur={onBlur} onPress={() => onPress(item)} style={styles.hit}>
      {({ focused }) => (
        <Animated.View style={[styles.card, focused && styles.cardFocused, { transform: [{ scale }] }]}>
          {uri && (
            <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={`${item.media_type}-${item.id}`} />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.9)']}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Icono de play sobre la miniatura: esta fila lleva directo a
              reproducir, no a la ficha, y conviene que se note antes de pulsar. */}
          <View style={styles.playBadge}>
            <Ionicons name="play" size={15} color="#000" />
          </View>

          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title.replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, '')}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {item.season != null && item.episode != null
                ? `T${item.season}:E${item.episode}`
                : 'Película'}
              {item.duration > 0 ? `  ·  ${left} min restantes` : ''}
            </Text>
          </View>

          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

/**
 * "Seguir viendo": lo empezado y no terminado, ordenado por lo más reciente
 * (lo ordena la propia librería del core).
 *
 * Va en formato apaisado y no en póster porque cada tarjeta tiene que mostrar
 * progreso, episodio y tiempo restante — en un póster 2:3 eso no entra sin
 * tapar la imagen.
 */
export function ContinueRow({
  items,
  onPressItem,
}: {
  items: Progress[]
  onPressItem: (p: Progress) => void
}) {
  const { ref, focusItem, onScrollToIndexFailed } = useRowFocusScroll<Progress>()
  const rowScroll = useRowScroll()

  if (!items?.length) return null

  return (
    <TVFocusGuideView style={styles.row} trapFocusRight>
      <Text style={styles.heading}>Seguir viendo</Text>
      <FlatList
        ref={ref}
        horizontal
        data={items}
        keyExtractor={(i) => `${i.media_type}-${i.id}-${i.season ?? 0}-${i.episode ?? 0}`}
        renderItem={({ item, index }) => (
          <ContinueCard
            item={item}
            onPress={onPressItem}
            onFocus={() => { focusItem(index); rowScroll() }}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={onScrollToIndexFailed}
        initialNumToRender={5}
      />
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: layout.rowGap },
  heading: { ...rowHeading, marginBottom: 10, paddingHorizontal: safe.horizontal },
  list: { paddingHorizontal: safe.horizontal, paddingVertical: 14 },
  hit: { marginRight: layout.cardGap },
  card: {
    width: layout.backdropWidth,
    height: layout.backdropHeight,
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
  },
  cardFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  playBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { paddingHorizontal: 12, paddingBottom: 12 },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  barTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  barFill: { height: '100%', backgroundColor: colors.text },
})
