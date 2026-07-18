import { useRef, useEffect, useMemo, useState } from 'react'
import {
  View,
  StyleSheet,
  Dimensions,
  Animated,
  Pressable,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Hero } from './Hero'
import { type MediaItem, backdropUrl } from '@/lib/tmdb'

const { width, height } = Dimensions.get('window')
const HERO_H = height * 0.74
const AUTO_MS = 7000
const MAX_ITEMS = 6

// Capa de fondo del pull-to-refresh: vive DETRÁS del FlatList, sin recorte
// horizontal, mostrando solo el backdrop del slide activo. Necesita estar
// separada del FlatList porque el Hero SÍ se recorta a sí mismo (styles.hero,
// overflow:hidden, para que el zoom del Ken Burns no sangre al vecino) — un
// recorte que mataría este estiramiento si viviera adentro. Al reposo
// (scale 1) queda tapada por el propio slide encima; solo se ve en el hueco
// que aparece arriba al halar.
function PullStretchBackdrop({ uri, scrollY }: { uri: string | null; scrollY?: Animated.Value }) {
  if (!uri || !scrollY) return null

  const transform = [
    {
      translateY: scrollY.interpolate({
        inputRange: [-HERO_H, 0],
        outputRange: [-HERO_H / 2, 0],
        extrapolateRight: 'clamp' as const,
      }),
    },
    {
      scale: scrollY.interpolate({
        inputRange: [-HERO_H, 0],
        outputRange: [2, 1],
        extrapolateLeft: 'extend' as const,
        extrapolateRight: 'clamp' as const,
      }),
    },
  ]

  return (
    <Animated.View pointerEvents="none" style={[styles.pullBackdrop, { transform }]}>
      <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" />
      {/* Mismo degradado que el fondo del Hero — si no, se ve más brillante al halar */}
      <LinearGradient
        colors={['rgba(0,0,0,0.25)', 'transparent', 'rgba(0,0,0,0.5)', '#000']}
        locations={[0, 0.35, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  )
}

// FlatList horizontal con paginado nativo — el scroll real sigue el dedo 1:1
// y el sistema resuelve solo el conflicto con el ScrollView vertical que lo
// envuelve (a diferencia del PanResponder manual anterior, que competía con
// los Pressable internos del Hero y perdía gestos).
export function HeroCarousel({
  items,
  scrollY,
}: {
  items: MediaItem[]
  scrollY?: Animated.Value
}) {
  const data = useMemo(
    () => items.filter((i) => i.backdrop_path).slice(0, MAX_ITEMS),
    [items]
  )

  // Dos valores para el mismo scroll:
  //  - scrollX: driver NATIVO, mueve los slides (transform/opacity). Tiene que
  //    ser nativo sí o sí: la contra-traslación del fundido cancela el scroll
  //    del FlatList, y si corriera en el hilo JS iría un frame atrás del scroll
  //    nativo y la imagen "temblaría" bajo el dedo.
  //  - scrollXDots: driver JS, solo para los dots (animan `width`, que el
  //    driver nativo no soporta). Son diminutos, un frame de retraso no se ve.
  const scrollX = useRef(new Animated.Value(0)).current
  const scrollXDots = useRef(new Animated.Value(0)).current
  const listRef = useRef<Animated.FlatList<MediaItem>>(null)
  const activeIdxRef = useRef(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  function goTo(index: number) {
    listRef.current?.scrollToOffset({ offset: index * width, animated: true })
  }

  function startTimer() {
    clearInterval(timerRef.current)
    if (data.length < 2) return
    timerRef.current = setInterval(() => {
      goTo((activeIdxRef.current + 1) % data.length)
    }, AUTO_MS)
  }

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, [data.length])

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width)
    activeIdxRef.current = idx
    setActiveIdx(idx)
    startTimer() // reinicia el autoplay recién cuando el paginado terminó de asentar
  }

  if (!data.length) return null

  return (
    <View style={styles.wrap}>
      <PullStretchBackdrop
        uri={backdropUrl(data[activeIdx]?.backdrop_path ?? null, 'original')}
        scrollY={scrollY}
      />

      <Animated.FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => String(item.id)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        bounces={false}
        onScrollBeginDrag={() => clearInterval(timerRef.current)}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          {
            useNativeDriver: true,
            // Los dots quedan fuera del driver nativo (animan `width`), así que
            // los alimentamos aparte desde acá.
            listener: (e: NativeSyntheticEvent<NativeScrollEvent>) =>
              scrollXDots.setValue(e.nativeEvent.contentOffset.x),
          }
        )}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => {
          const inputRange = [(index - 1) * width, index * width, (index + 1) * width]
          // Contra-traslación (= scrollX - index*width): cancela exactamente el
          // desplazamiento del FlatList, así TODOS los slides quedan apilados en
          // el centro en vez de uno al lado del otro. Con las imágenes
          // superpuestas, la opacidad cruzada da un fundido real; sin esto solo
          // se verían dos mitades oscureciéndose (un "fundido a negro" sucio).
          // El swipe lo sigue manejando el FlatList: el dedo mueve el scroll y
          // el scroll maneja el fundido.
          const translateX = scrollX.interpolate({
            inputRange,
            outputRange: [-width, 0, width],
            extrapolate: 'clamp',
          })
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0, 1, 0],
            extrapolate: 'clamp',
          })
          return (
            <Animated.View
              style={[styles.slide, { transform: [{ translateX }], opacity }]}
              // Apilados, el último del listado quedaría encima capturando los
              // toques del Hero (Reproducir / +). Solo el activo los recibe.
              pointerEvents={index === activeIdx ? 'auto' : 'none'}
            >
              <Hero item={item} active={index === activeIdx} scrollY={scrollY} />
            </Animated.View>
          )
        }}
      />

      {/* Dots — tocables: saltan directo a ese slide y reinician el autoplay */}
      <View style={styles.dots} pointerEvents="box-none">
        {data.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width]
          const dotWidth = scrollXDots.interpolate({
            inputRange,
            outputRange: [5, 26, 5],
            extrapolate: 'clamp',
          })
          const opacity = scrollXDots.interpolate({
            inputRange,
            outputRange: [0.4, 1, 0.4],
            extrapolate: 'clamp',
          })
          return (
            <Pressable key={i} hitSlop={10} onPress={() => goTo(i)}>
              <Animated.View style={[styles.dot, { width: dotWidth, opacity }]} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width, height: HERO_H },
  pullBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1C1C1E' },
  // Sin overflow:hidden a propósito: los slides van contra-trasladados para
  // apilarse (ver renderItem) y este recorte los cortaría a la mitad. El Hero
  // ya se recorta a sí mismo (styles.hero), así que el zoom del Ken Burns
  // sigue sin sangrar al vecino.
  slide: { width, height: HERO_H },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { height: 5, borderRadius: 2.5, backgroundColor: '#fff' },
})
