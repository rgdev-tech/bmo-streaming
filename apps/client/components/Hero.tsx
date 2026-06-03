import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { useState, useEffect } from 'react'
import { tmdb, type MediaItem, backdropUrl, titleOf, isUpcoming, logoUrl } from '@/lib/tmdb'

const { width } = Dimensions.get('window')
const HERO_HEIGHT = width * 1.25

export function Hero({ item, brand = 'BMO' }: { item: MediaItem; brand?: string }) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  const bg = backdropUrl(item.backdrop_path, 'w1280')
  const upcoming = isUpcoming(item)

  const [logo, setLogo] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    tmdb
      .logo(isTv ? 'tv' : 'movie', item.id)
      .then((r) => !cancelled && setLogo(logoUrl(r.logo)))
      .catch(() => {})
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

  return (
    <View style={styles.hero}>
      {bg && <Image source={bg} style={styles.bg} contentFit="cover" transition={300} />}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', '#000']}
        locations={[0, 0.65, 1]}
        style={styles.gradient}
      />

      <View style={styles.brand}>
        <Text style={styles.brandText}>{brand}</Text>
      </View>

      <View style={styles.content}>
        {logo ? (
          <Image
            source={logo}
            style={styles.logo}
            contentFit="contain"
            transition={300}
          />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {titleOf(item)}
          </Text>
        )}
        <Text style={styles.overview} numberOfLines={2}>
          {item.overview}
        </Text>

        <View style={styles.buttons}>
          {upcoming ? (
            <View style={styles.soonBtn}>
              <SymbolView name="clock" tintColor="rgba(255,255,255,0.7)" style={styles.btnIcon} />
              <Text style={styles.infoText}>Próximamente</Text>
            </View>
          ) : (
            <Pressable style={styles.playBtn} onPress={play}>
              <SymbolView name="play.fill" tintColor="#000" style={styles.btnIcon} />
              <Text style={styles.playText}>Reproducir</Text>
            </Pressable>
          )}
          <Pressable style={styles.infoBtn} onPress={open}>
            <SymbolView name="info.circle" tintColor="#fff" style={styles.btnIcon} />
            <Text style={styles.infoText}>Más info</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { width, height: HERO_HEIGHT, marginBottom: 8 },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1C1C1E' },
  gradient: { ...StyleSheet.absoluteFillObject },
  brand: { position: 'absolute', top: 64, left: 20 },
  brandText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  content: { position: 'absolute', bottom: 24, left: 0, right: 0, paddingHorizontal: 20 },
  logo: {
    width: width * 0.7,
    height: 90,
    alignSelf: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  overview: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
  },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 8,
  },
  infoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 8,
  },
  soonBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 8,
  },
  btnIcon: { width: 16, height: 16 },
  playText: { color: '#000', fontSize: 16, fontWeight: '700' },
  infoText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
