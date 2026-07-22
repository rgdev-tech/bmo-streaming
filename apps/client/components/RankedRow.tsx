import { View, Text, FlatList, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { type MediaItem, posterUrl, titleOf } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { rowHeading } from '@/lib/typography'

const CARD_W = 110
const CARD_H = CARD_W * 1.5
const NUM_W = 36

function RankedCard({ item, rank }: { item: MediaItem; rank: number }) {
  const router = useRouter()
  const uri = posterUrl(item.poster_path, 'w500')
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)

  return (
    <Touchable
      style={styles.card}
      haptic="light"
      onPressIn={() => prewarmTitle(item.id, isTv)}
      onPress={() => router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)}
    >
      <Text style={styles.num}>{rank}</Text>
      {uri ? (
        <Image source={uri} style={styles.poster} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
      ) : (
        <View style={[styles.poster, styles.placeholder]}>
          <Text style={styles.placeholderText} numberOfLines={3}>{titleOf(item)}</Text>
        </View>
      )}
    </Touchable>
  )
}

export function RankedRow({ title, items }: { title: string; items: MediaItem[] }) {
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={items.slice(0, 10)}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => <RankedCard item={item} rank={index + 1} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: 24 },
  heading: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  list: { paddingHorizontal: 20, paddingLeft: 20 - NUM_W + 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginRight: 8,
  },
  num: {
    width: NUM_W,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 52,
    letterSpacing: -3,
    textAlign: 'right',
    marginRight: -6,
    zIndex: 1,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  poster: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    textAlign: 'center',
  },
})
