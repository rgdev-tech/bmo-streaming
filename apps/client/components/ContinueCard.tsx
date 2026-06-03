import { Pressable, View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { backdropUrl, posterUrl } from '@/lib/tmdb'
import type { Progress } from '@/lib/library'

const CARD_WIDTH = 200

export function ContinueCard({ item }: { item: Progress }) {
  const router = useRouter()
  const img = backdropUrl(item.backdrop_path, 'w780') ?? posterUrl(item.poster_path)
  const ratio = item.duration > 0 ? item.position / item.duration : 0

  function resume() {
    router.push({
      pathname: '/player',
      params: {
        type: item.media_type,
        id: String(item.id),
        title: item.title,
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(item.media_type === 'tv'
          ? { season: String(item.season ?? 1), episode: String(item.episode ?? 1) }
          : {}),
      },
    })
  }

  return (
    <Pressable style={styles.card} onPress={resume}>
      <View style={styles.thumbWrap}>
        {img ? (
          <Image source={img} style={styles.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.thumb, styles.empty]} />
        )}
        <View style={styles.playOverlay}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
        </View>
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
        {item.media_type === 'tv' && item.season
          ? `  ·  T${item.season}:E${item.episode}`
          : ''}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH, marginRight: 12 },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 0.56,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
  },
  empty: { backgroundColor: '#1C1C1E' },
  playOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 16,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  progressTrack: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  title: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500', marginTop: 6 },
})
