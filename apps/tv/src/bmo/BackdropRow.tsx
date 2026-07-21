import { Animated, FlatList, Pressable, StyleSheet, Text, TVFocusGuideView, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, posterUrl, titleOf, type MediaItem } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
import { useRowFocusScroll } from './useRowFocusScroll'
import { useRowScroll } from './RowScrollContext'
import { colors, layout, rowHeading, safe } from './theme'

/**
 * Fila de tarjetas apaisadas 16:9.
 *
 * Existe para cortar el ritmo: una home de seis filas de pósters iguales se
 * vuelve un muro y el ojo deja de distinguir dónde está. Intercalar una fila
 * ancha cada tantas da puntos de referencia al recorrer verticalmente.
 *
 * A diferencia del póster, acá el título SÍ va sobreimpreso: los backdrops son
 * fotogramas sin texto, así que sin rótulo no se sabe qué es.
 */
function BackdropCard({
  item,
  onPress,
  onFocus,
}: {
  item: MediaItem
  onPress?: (item: MediaItem) => void
  onFocus?: () => void
}) {
  const { scale, onFocus: onScaleFocus, onBlur } = useFocusScale(1.05)
  // Si no hay backdrop se cae al póster antes que dejar un hueco gris. w300 basta
  // para 248 dp y pesa mucho menos que w780 (decode/GPU en el emulador).
  const uri = backdropUrl(item.backdrop_path, 'w300') ?? posterUrl(item.poster_path, 'w342')

  return (
    <Pressable onFocus={() => { onScaleFocus(); onFocus?.() }} onBlur={onBlur} onPress={() => onPress?.(item)} style={styles.hit}>
      {({ focused }) => (
        <Animated.View
          style={[styles.card, focused && styles.cardFocused, { transform: [{ scale }] }]}
        >
          {uri && (
            <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            locations={[0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.title} numberOfLines={1}>
            {titleOf(item)}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

export function BackdropRow({
  title,
  items,
  onPressItem,
}: {
  title: string
  items: MediaItem[]
  onPressItem?: (item: MediaItem) => void
}) {
  const { ref, focusItem, onScrollToIndexFailed } = useRowFocusScroll<MediaItem>()
  const rowScroll = useRowScroll()

  if (!items?.length) return null

  return (
    <TVFocusGuideView style={styles.row} trapFocusRight>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        ref={ref}
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <BackdropCard
            item={item}
            onPress={onPressItem}
            onFocus={() => { focusItem(index); rowScroll() }}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={onScrollToIndexFailed}
        initialNumToRender={5}
        windowSize={5}
      />
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: layout.rowGap },
  heading: {
    ...rowHeading,
    marginBottom: 10,
    paddingHorizontal: safe.horizontal,
  },
  list: {
    paddingHorizontal: safe.horizontal,
    paddingVertical: 14,
  },
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
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
})
