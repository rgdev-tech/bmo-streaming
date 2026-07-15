import { Pressable, Text, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { type MediaItem, posterUrl, titleOf, isUpcoming } from '@/lib/tmdb'
import { Touchable } from './Touchable'

const CARD_WIDTH = 124

export function PosterCard({
  item,
  width,
  onRemove,
}: {
  item: MediaItem
  width?: number
  onRemove?: () => void
}) {
  const router = useRouter()
  const uri = posterUrl(item.poster_path)
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  // Solo marcamos "Próximamente" si HAY una fecha y es futura.
  // (Items sin fecha — p.ej. los guardados en Mi Lista — no se marcan.)
  const hasDate = !!(item.release_date ?? item.first_air_date)
  const upcoming = hasDate && isUpcoming(item)

  const cardStyle = width != null ? { width, marginRight: 0 } : null
  const posterStyle = width != null ? { width, height: width * 1.5 } : null

  return (
    <Pressable
      style={[styles.card, cardStyle]}
      onPress={() =>
        router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)
      }
    >
      <View>
        {uri ? (
          <Image source={uri} style={[styles.poster, posterStyle]} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.poster, posterStyle, styles.placeholder]}>
            <Text style={styles.placeholderText} numberOfLines={3}>
              {titleOf(item)}
            </Text>
          </View>
        )}

        {/* Badge "Próximamente" para títulos no estrenados */}
        {upcoming && (
          <View style={styles.soonBadge}>
            <Text style={styles.soonText}>PRÓXIMAMENTE</Text>
          </View>
        )}

        {/* Botón quitar (Mi Lista) */}
        {onRemove && (
          <Touchable style={styles.removeBtn} scaleTo={0.85} haptic="light" onPress={onRemove} hitSlop={8}>
            <SymbolView name="xmark" tintColor="#fff" style={styles.removeIcon} />
          </Touchable>
        )}
      </View>

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
  soonBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  soonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: { width: 11, height: 11 },
  title: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
  },
})
