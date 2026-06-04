import { View, Text, FlatList, StyleSheet, Pressable, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { type MediaItem, backdropUrl, titleOf } from '@/lib/tmdb'

const { width } = Dimensions.get('window')
const CARD_W = Math.round(width * 0.62)
const CARD_H = Math.round(CARD_W * 0.56)

function BackdropCard({ item }: { item: MediaItem }) {
  const router = useRouter()
  const uri = backdropUrl(item.backdrop_path, 'w780')
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)}
    >
      {uri ? (
        <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.8)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.title} numberOfLines={2}>{titleOf(item)}</Text>
    </Pressable>
  )
}

export function BackdropRow({ title, items }: { title: string; items: MediaItem[] }) {
  const filtered = items.filter((i) => i.backdrop_path)
  if (!filtered.length) return null

  return (
    <View style={styles.row}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <BackdropCard item={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: 24 },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  list: { paddingHorizontal: 20, gap: 10 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
  },
  placeholder: { backgroundColor: '#2C2C2E' },
  title: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
})
