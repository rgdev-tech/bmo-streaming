import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, Pressable, Dimensions, Animated } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import {
  tmdb,
  type MediaItem,
  backdropUrl,
  titleOf,
  isUpcoming,
  logoUrl,
  genreNames,
} from '@/lib/tmdb'
import { isInMyList, toggleMyList, toLibraryItem } from '@/lib/library'

const { width, height } = Dimensions.get('window')
const HERO_H = height * 0.74

export function Hero({ item, scrollY }: { item: MediaItem; scrollY?: Animated.Value }) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  const bg = backdropUrl(item.backdrop_path, 'w1280')
  const upcoming = isUpcoming(item)

  const [logo, setLogo] = useState<string | null>(null)
  const [inList, setInList] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLogo(null) // limpia el logo anterior al cambiar de título (evita el flash)
    tmdb
      .logo(isTv ? 'tv' : 'movie', item.id)
      .then((r) => !cancelled && setLogo(logoUrl(r.logo)))
      .catch(() => {})
    isInMyList(item.id, isTv ? 'tv' : 'movie').then(
      (v) => !cancelled && setInList(v)
    )
    return () => {
      cancelled = true
    }
  }, [item.id, isTv])

  function open() {
    router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)
  }

  function play() {
    router.push({
      pathname: '/player',
      params: {
        type: isTv ? 'tv' : 'movie',
        id: String(item.id),
        title: titleOf(item),
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(isTv ? { season: '1', episode: '1' } : {}),
      },
    })
  }

  async function toggleList() {
    const added = await toggleMyList(
      toLibraryItem({ ...item, media_type: isTv ? 'tv' : 'movie' })
    )
    setInList(added)
  }

  const meta = [isTv ? 'Serie' : 'Película', ...genreNames(item.genre_ids)].join('  ·  ')

  // Estira la imagen al hacer pull (overscroll) anclada al fondo:
  // crece SOLO hacia arriba (translateY compensa) — nunca tapa el contenido de abajo.
  const bgTransform = scrollY
    ? {
        transform: [
          {
            translateY: scrollY.interpolate({
              inputRange: [-HERO_H, 0],
              outputRange: [-HERO_H / 2, 0],
              extrapolateRight: 'clamp',
            }),
          },
          {
            scale: scrollY.interpolate({
              inputRange: [-HERO_H, 0],
              outputRange: [2, 1],
              extrapolateLeft: 'extend',
              extrapolateRight: 'clamp',
            }),
          },
        ],
      }
    : undefined

  return (
    <View style={styles.hero}>
      {bg && (
        <Animated.View style={[StyleSheet.absoluteFill, bgTransform]}>
          <Image source={bg} style={styles.bg} contentFit="cover" transition={300} />
          {/* El degradado va DENTRO del transform para estirarse junto a la imagen */}
          <LinearGradient
            colors={['rgba(0,0,0,0.25)', 'transparent', 'rgba(0,0,0,0.5)', '#000']}
            locations={[0, 0.35, 0.78, 1]}
            style={styles.gradient}
          />
        </Animated.View>
      )}

      <View style={styles.content}>
        <View style={styles.logoBox}>
          {logo ? (
            <Image source={logo} style={styles.logo} contentFit="contain" transition={400} />
          ) : (
            <Text style={styles.title} numberOfLines={2}>
              {titleOf(item)}
            </Text>
          )}
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>

        <View style={styles.buttons}>
          {upcoming ? (
            <View style={styles.soonBtn}>
              <SymbolView name="clock" tintColor="rgba(255,255,255,0.8)" style={styles.playIcon} />
              <Text style={styles.soonText}>Próximamente</Text>
            </View>
          ) : (
            <Pressable style={styles.playBtn} onPress={play}>
              <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
              <Text style={styles.playText}>Reproducir</Text>
            </Pressable>
          )}
          <Pressable style={styles.addBtn} onPress={toggleList}>
            <SymbolView
              name={inList ? 'checkmark' : 'plus'}
              tintColor="#fff"
              style={styles.addIcon}
            />
          </Pressable>
        </View>
      </View>

      {/* Toque en el arte → detalle */}
      <Pressable style={styles.tapArea} onPress={open} />
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { width, height: HERO_H },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1C1C1E' },
  gradient: { ...StyleSheet.absoluteFillObject },
  tapArea: { position: 'absolute', top: 0, left: 0, right: 0, height: '60%' },
  content: { position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  logoBox: { height: 100, justifyContent: 'flex-end', alignItems: 'center' },
  logo: { width: width * 0.72, height: 100 },
  title: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.5, textAlign: 'center' },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    gap: 8,
  },
  soonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    gap: 8,
  },
  playIcon: { width: 16, height: 16 },
  playText: { color: '#000', fontSize: 16, fontWeight: '700' },
  soonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  addBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: { width: 22, height: 22 },
})
