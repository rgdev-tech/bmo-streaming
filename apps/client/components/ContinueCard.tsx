import { Pressable, View, Text, StyleSheet, Alert } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { backdropUrl, posterUrl } from '@/lib/tmdb'
import { removeProgress, type Progress } from '@/lib/library'

const CARD_WIDTH = 300

function remainingLabel(p: Progress) {
  const rem = Math.max(0, p.duration - p.position)
  const mins = Math.round(rem / 60)
  const time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`
  if (p.media_type === 'tv' && p.season) {
    return `T${p.season}, E${p.episode} · ${time}`
  }
  return time
}

export function ContinueCard({
  item,
  onRemove,
}: {
  item: Progress
  onRemove?: () => void
}) {
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

  function more() {
    Alert.alert(item.title, undefined, [
      {
        text: 'Quitar de Seguir viendo',
        style: 'destructive',
        onPress: async () => {
          await removeProgress(item.id, item.media_type)
          onRemove?.()
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  return (
    <Pressable style={styles.card} onPress={resume}>
      {img ? (
        <Image source={img} style={styles.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.thumb, styles.empty]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={styles.overlay}
      />

      <View style={styles.bottom}>
        <View style={styles.left}>
          <SymbolView name="play.fill" tintColor="#fff" style={styles.playIcon} />
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
          <Text style={styles.time} numberOfLines={1}>
            {remainingLabel(item)}
          </Text>
        </View>
        <Pressable onPress={more} hitSlop={12}>
          <SymbolView name="ellipsis" tintColor="#fff" style={styles.more} />
        </Pressable>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 0.58,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
    backgroundColor: '#1C1C1E',
  },
  thumb: { ...StyleSheet.absoluteFillObject },
  empty: { backgroundColor: '#1C1C1E' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  bottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  playIcon: { width: 13, height: 13 },
  track: {
    width: 54,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  time: { color: '#fff', fontSize: 13, fontWeight: '600' },
  more: { width: 20, height: 20 },
})
