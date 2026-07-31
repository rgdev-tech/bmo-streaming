import { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Dimensions, Animated, Easing } from 'react-native'
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
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

const { width, height } = Dimensions.get('window')
const HERO_H = height * 0.74
const KEN_BURNS_MS = 9000 // más lento que el auto-advance del carrusel (7s) → nunca se nota el corte
const KEN_BURNS_SCALE = 1.09

export function Hero({ item, active, scrollY }: { item: MediaItem; active: boolean; scrollY?: Animated.Value }) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  // 'original' — mismo tamaño que sirve TMDB, sin el recorte de calidad de w1280.
  // Solo el slide activo (y el que ya se visitó) carga esta calidad — el resto
  // del carrusel no gasta ancho de banda en imágenes que quizás nunca se vean.
  const bg = backdropUrl(item.backdrop_path, active ? 'original' : 'w780')
  const upcoming = isUpcoming(item)

  const [logo, setLogo] = useState<string | null>(null)
  const [inList, setInList] = useState(false)

  // Logo + estado de "Mi Lista" solo se piden la PRIMERA vez que el slide se
  // activa (no en los 6 al montar el carrusel) — evita 2×N llamadas de red
  // inútiles al abrir Home.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!active || loadedRef.current) return
    loadedRef.current = true
    let cancelled = false
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
  }, [active, item.id, isTv])

  // Ken Burns: zoom lento y continuo mientras el slide está activo (look de cine,
  // como Apple TV/Netflix) — se resetea al desactivarse para volver fresco.
  const kenBurns = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!active) {
      kenBurns.setValue(1)
      return
    }
    const anim = Animated.timing(kenBurns, {
      toValue: KEN_BURNS_SCALE,
      duration: KEN_BURNS_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [active])

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

  // Solo Ken Burns aquí — el estiramiento por pull-to-refresh vive en una capa
  // aparte (PullStretchBackdrop, en HeroCarousel) que no está recortada
  // horizontalmente, así el zoom grande del pull no sangra al slide vecino.
  const bgTransform = { transform: [{ scale: kenBurns }] }

  // En cuanto empieza el halón, este fondo se desvanece para dejar ver SOLO
  // el PullStretchBackdrop de atrás (que sí se estira) — si ambos quedaran
  // visibles a la vez se ve la imagen duplicada/fantasma.
  const bgOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [-20, 0], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1

  return (
    <View style={styles.hero}>
      {bg && (
        <Animated.View style={[StyleSheet.absoluteFill, bgTransform, { opacity: bgOpacity }]}>
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
        <View style={styles.trendingBadge}>
          <Text style={styles.trendingText}>Tendencia</Text>
        </View>

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
            <Touchable
              scaleTo={0.95}
              haptic="medium"
              style={styles.playBtn}
              onPressIn={() => prewarmTitle(item.id, isTv)}
              onPress={play}
            >
              <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
              <Text style={styles.playText}>Reproducir</Text>
            </Touchable>
          )}
          <Touchable scaleTo={0.9} haptic="light" style={styles.addBtn} onPress={toggleList}>
            <SymbolView
              name={inList ? 'checkmark' : 'plus'}
              tintColor="#fff"
              style={styles.addIcon}
            />
          </Touchable>
        </View>
      </View>

      {/* Toque en el arte → detalle */}
      <Touchable
        scaleTo={1}
        style={styles.tapArea}
        onPressIn={() => prewarmTitle(item.id, isTv)}
        onPress={open}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // overflow:hidden — el zoom del Ken Burns crece la imagen más allá de estos
  // límites; sin recorte se asoma al slide vecino del carrusel (están uno al
  // lado del otro dentro del FlatList horizontal).
  hero: { width, height: HERO_H, overflow: 'hidden' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface },
  gradient: { ...StyleSheet.absoluteFillObject },
  tapArea: { position: 'absolute', top: 0, left: 0, right: 0, height: '60%' },
  content: { position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  trendingBadge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  trendingText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
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
    borderRadius: 27,
    paddingVertical: 14,
    paddingHorizontal: 40,
    gap: 8,
  },
  soonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 27,
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
