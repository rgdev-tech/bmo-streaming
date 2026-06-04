import { useRef, useEffect, useMemo, useState } from 'react'
import {
  View,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  Easing,
} from 'react-native'
import { Hero } from './Hero'
import { type MediaItem } from '@/lib/tmdb'

const { width, height } = Dimensions.get('window')
const HERO_H = height * 0.74
const AUTO_MS = 7000
const FADE_MS = 480
const SWIPE_THRESHOLD = 45
const MAX_ITEMS = 6

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

  // Un Animated.Value de opacidad por slot (fijo, nunca se recrea)
  // El primero empieza en 1, el resto en 0
  const opacities = useRef(
    Array.from({ length: MAX_ITEMS }, (_, i) => new Animated.Value(i === 0 ? 1 : 0))
  ).current

  const dotAnim = useRef(new Animated.Value(0)).current
  const currentIdxRef = useRef(0)
  const isAnimating = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  // Solo para pointerEvents: actualiza DESPUÉS de que termine la animación
  const [activeIdx, setActiveIdx] = useState(0)

  function crossfadeTo(next: number) {
    if (isAnimating.current || next === currentIdxRef.current) return
    isAnimating.current = true
    const prev = currentIdxRef.current

    // Dot sigue la transición
    Animated.timing(dotAnim, {
      toValue: next,
      duration: FADE_MS,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start()

    // Crossfade: prev → 0, next → 1 en paralelo (native thread, sin parpadeo)
    Animated.parallel([
      Animated.timing(opacities[prev], {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(opacities[next], {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start(() => {
      currentIdxRef.current = next
      setActiveIdx(next)
      isAnimating.current = false
    })
  }

  function startTimer() {
    clearInterval(timerRef.current)
    if (data.length < 2) return
    timerRef.current = setInterval(() => {
      const next = (currentIdxRef.current + 1) % data.length
      crossfadeTo(next)
    }, AUTO_MS)
  }

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, [data.length])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
        onPanResponderGrant: () => clearInterval(timerRef.current),
        onPanResponderRelease: (_, { dx }) => {
          if (Math.abs(dx) >= SWIPE_THRESHOLD) {
            const dir = dx > 0 ? -1 : 1
            const next = (currentIdxRef.current + dir + data.length) % data.length
            crossfadeTo(next)
          }
          startTimer()
        },
      }),
    [data.length]
  )

  if (!data.length) return null

  return (
    <View style={styles.wrap} {...panResponder.panHandlers}>
      {/* Todos los heroes pre-renderizados; solo cambia su opacidad */}
      {data.map((item, i) => (
        <Animated.View
          key={String(item.id)}
          style={[styles.layer, { opacity: opacities[i] }]}
          pointerEvents={i === activeIdx ? 'box-none' : 'none'}
        >
          <Hero item={item} scrollY={scrollY} />
        </Animated.View>
      ))}

      {/* Dots */}
      <View style={styles.dots} pointerEvents="box-none">
        {data.map((_, i) => {
          const dotWidth = dotAnim.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [6, 18, 6],
            extrapolate: 'clamp',
          })
          const opacity = dotAnim.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [0.35, 1, 0.35],
            extrapolate: 'clamp',
          })
          return (
            <Animated.View key={i} style={[styles.dot, { width: dotWidth, opacity }]} />
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width, height: HERO_H },
  layer: { position: 'absolute', width, height: HERO_H },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { height: 6, borderRadius: 3, backgroundColor: '#fff' },
})
