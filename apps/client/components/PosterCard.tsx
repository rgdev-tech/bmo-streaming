import { Pressable, Text, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { type MediaItem, posterUrl, titleOf } from '@/lib/tmdb'

const CARD_WIDTH = 124

export function PosterCard({ item, width }: { item: MediaItem; width?: number }) {
  const router = useRouter()
  const uri = posterUrl(item.poster_path)
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)

  // En cuadrícula se pasa un ancho; en fila usa el ancho fijo
  const cardStyle = width != null ? { width, marginRight: 0 } : null
  const posterStyle = width != null ? { width, height: width * 1.5 } : null

  return (
    <Pressable
      style={[styles.card, cardStyle]}
      onPress={() =>
        router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)
      }
    >
      {uri ? (
        <Image source={uri} style={[styles.poster, posterStyle]} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.poster, posterStyle, styles.placeholder]}>
          <Text style={styles.placeholderText} numberOfLines={3}>
            {titleOf(item)}
          </Text>
        </View>
      )}
      <Text style={styles.title} numberOfLines={1}>
        {titleOf(item)}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    marginRight: 12,
  },
  poster: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.5,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
  },
  title: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
  },
})
