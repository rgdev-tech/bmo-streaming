import { Text, StyleSheet, View, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { type MediaItem, backdropUrl, titleOf, genreNames } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const CARD_W = width - 32
const CARD_H = CARD_W * 0.56

export function FeaturedCard({ item }: { item: MediaItem }) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  // Card casi a todo el ancho → ~1074px en 3x: w1280 nítido (w780 quedaba blando).
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
      <View style={styles.imageWrap}>
        {uri ? (
          <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.title} numberOfLines={2}>{titleOf(item)}</Text>
      </View>

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

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  imageWrap: { width: CARD_W, height: CARD_H },
  placeholder: { backgroundColor: colors.surfaceHigh },
  title: {
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
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  overview: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
})
