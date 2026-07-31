import { useRef } from 'react'
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { type MediaItem, backdropUrl, titleOf, genreNames } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const CARD_W = width - 32
const IMG_H = Math.round(CARD_W * 0.56)

function CarouselCard({ item }: { item: MediaItem }) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  // Carrusel casi a todo el ancho → ~1074px en 3x: w1280 nítido (w780 blando).
  const uri = backdropUrl(item.backdrop_path, 'w1280')
  const genres = genreNames(item.genre_ids, 3)
  const type = isTv ? 'Serie' : 'Película'

  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      style={styles.card}
      onPressIn={() => prewarmTitle(item.id, isTv)}
      onPress={() => router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)}
    >
      {/* Imagen backdrop */}
      <View style={styles.imgWrap}>
        {uri ? (
          <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.75)']}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.imgTitle} numberOfLines={2}>{titleOf(item)}</Text>
      </View>

      {/* Meta */}
      <View style={styles.meta}>
        <Text style={styles.metaLine} numberOfLines={1}>
          {[type, ...genres].join(' · ')}
        </Text>
        {!!item.overview && (
          <Text style={styles.overview} numberOfLines={3}>{item.overview}</Text>
        )}
      </View>
    </Touchable>
  )
}

const SNAP = CARD_W + 12

export function FeaturedCarousel({ items }: { items: MediaItem[] }) {
  const scrollX = useRef(new Animated.Value(0)).current

  if (!items.length) return null

  const visible = items.slice(0, 6)

  return (
    <View style={styles.wrap}>
      <Animated.FlatList
        horizontal
        pagingEnabled={false}
        snapToInterval={SNAP}
        snapToAlignment="start"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        data={visible}
        keyExtractor={(item: MediaItem) => String(item.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }: { item: MediaItem }) => <CarouselCard item={item} />}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      />

      {/* Dots animados */}
      {visible.length > 1 && (
        <View style={styles.dots}>
          {visible.map((_, i) => {
            const inputRange = [(i - 1) * SNAP, i * SNAP, (i + 1) * SNAP]
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [6, 18, 6],
              extrapolate: 'clamp',
            })
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            })
            return (
              <Animated.View
                key={i}
                style={[styles.dot, { width: dotWidth, opacity }]}
              />
            )
          })}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  listContent: { paddingHorizontal: 16, gap: 12 },

  card: {
    width: CARD_W,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  imgWrap: {
    width: CARD_W,
    height: IMG_H,
  },
  placeholder: { backgroundColor: colors.surfaceHigh },
  imgTitle: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  meta: { padding: 14, paddingTop: 10 },
  metaLine: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  overview: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },

  // Dots
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 10,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
})
