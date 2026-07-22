import { Animated, FlatList, Pressable, StyleSheet, Text, TVFocusGuideView, View } from 'react-native'
import { Image } from 'expo-image'
import { posterUrl, titleOf, type MediaItem } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
import { useRowFocusScroll } from './useRowFocusScroll'
import { useRowScroll } from './RowScrollContext'
import { colors, layout, rowHeading, safe } from './theme'

const NUM_WIDTH = 52
// El contentContainer arranca corrido a la izquierda (el número sobresale del
// póster); el scroll al foco usa el mismo offset para que el ítem enfocado
// descanse donde descansa el #1.
const RANKED_LEFT = safe.horizontal - NUM_WIDTH + 14

/**
 * Fila de Top 10 con el número gigante detrás del póster.
 *
 * Es la fila con más peso visual de la home, y por eso va una sola vez: si se
 * repitiera, el recurso deja de leerse como "esto es lo más visto" y pasa a ser
 * decoración.
 */
function RankedCard({
  item,
  rank,
  onPress,
  onFocus,
}: {
  item: MediaItem
  rank: number
  onPress?: (item: MediaItem) => void
  onFocus?: () => void
}) {
  const { scale, onFocus: onScaleFocus, onBlur } = useFocusScale()
  // Póster de 124 dp (igual que PosterCard normal): w342 alcanza y pesa la mitad
  // que w500 — mismo criterio que el resto de las tarjetas chicas.
  const uri = posterUrl(item.poster_path, 'w342')

  return (
    <Pressable onFocus={() => { onScaleFocus(); onFocus?.() }} onBlur={onBlur} onPress={() => onPress?.(item)} style={styles.hit}>
      {({ focused }) => (
        // La escala del foco va SOLO en el póster, no en el card entero: antes el
        // número gigante (72px, con margen negativo que solapa el póster) escalaba
        // junto y, al crecer/encogerse desde el centro, se corría y "saltaba" al
        // mover el foco — el bug que solo se veía en esta fila. Con la escala en el
        // póster, el número queda fijo y solo el arte responde al foco, como el
        // resto de las filas.
        <View style={styles.card}>
          {/* El número va debajo del póster y sobresale por la izquierda; el
              margen negativo del póster es lo que los hace solaparse. */}
          <Text style={styles.num}>{rank}</Text>
          <Animated.View style={[styles.posterWrap, focused && styles.posterWrapFocused, { transform: [{ scale }] }]}>
            {uri ? (
              <Image source={uri} style={styles.poster} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
            ) : (
              <View style={[styles.poster, styles.placeholder]}>
                <Text style={styles.placeholderText} numberOfLines={3}>
                  {titleOf(item)}
                </Text>
              </View>
            )}
          </Animated.View>
        </View>
      )}
    </Pressable>
  )
}

export function RankedRow({
  title,
  items,
  onPressItem,
}: {
  title: string
  items: MediaItem[]
  onPressItem?: (item: MediaItem) => void
}) {
  const { ref, focusItem, onScrollToIndexFailed } = useRowFocusScroll<MediaItem>(RANKED_LEFT)
  const rowScroll = useRowScroll()

  if (!items?.length) return null

  return (
    <TVFocusGuideView style={styles.row} trapFocusRight>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        ref={ref}
        horizontal
        data={items.slice(0, 10)}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <RankedCard
            item={item}
            rank={index + 1}
            onPress={onPressItem}
            onFocus={() => { focusItem(index); rowScroll(layout.posterHeight) }}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={onScrollToIndexFailed}
        initialNumToRender={6}
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
  // El primer número tiene que quedar alineado con el resto del contenido, y el
  // número sobresale del póster, así que se descuenta su ancho del padding.
  list: {
    paddingLeft: safe.horizontal - NUM_WIDTH + 14,
    paddingRight: safe.horizontal,
    paddingVertical: 14,
  },
  hit: { marginRight: 10 },
  card: { flexDirection: 'row', alignItems: 'flex-end' },
  num: {
    width: NUM_WIDTH,
    fontSize: 72,
    lineHeight: 74,
    fontWeight: '900',
    letterSpacing: -5,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.9)',
    // Contorno oscuro: sobre pósters claros el número blanco se perdía.
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 6,
    marginRight: -10,
  },
  posterWrap: {
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  posterWrapFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  poster: {
    width: layout.posterWidth,
    height: layout.posterHeight,
    backgroundColor: colors.surface,
  },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  placeholderText: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
  },
})
