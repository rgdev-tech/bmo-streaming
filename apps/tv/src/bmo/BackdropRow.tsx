import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, posterUrl, titleOf, type MediaItem } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
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
}: {
  item: MediaItem
  onPress?: (item: MediaItem) => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.05)
  // Si no hay backdrop se cae al póster antes que dejar un hueco gris.
  const uri = backdropUrl(item.backdrop_path, 'w780') ?? posterUrl(item.poster_path, 'w500')

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress?.(item)} style={styles.hit}>
      {({ focused }) => (
        <Animated.View
          style={[styles.card, focused && styles.cardFocused, { transform: [{ scale }] }]}
        >
          {uri && (
            <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
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
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <BackdropCard item={item} onPress={onPressItem} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={5}
        windowSize={5}
      />
    </View>
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
