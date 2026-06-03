import { useState, useEffect, useMemo } from 'react'
import { View, Pressable, StyleSheet, Dimensions, Animated } from 'react-native'
import { Hero } from './Hero'
import { type MediaItem } from '@/lib/tmdb'

const { width, height } = Dimensions.get('window')
const HERO_H = height * 0.74
const AUTO_MS = 7000

export function HeroCarousel({
  items,
  scrollY,
}: {
  items: MediaItem[]
  scrollY?: Animated.Value
}) {
  const data = useMemo(
    () => items.filter((i) => i.backdrop_path).slice(0, 6),
    [items]
  )
  const [index, setIndex] = useState(0)

  // Auto-rota con crossfade (sin carrusel horizontal → sin conflicto de gestos)
  useEffect(() => {
    if (data.length < 2) return
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % data.length)
    }, AUTO_MS)
    return () => clearInterval(t)
  }, [data.length])

  if (!data.length) return null
  const item = data[index]

  return (
    <View style={styles.wrap}>
      <Hero item={item} scrollY={scrollY} />

      <View style={styles.dots} pointerEvents="box-none">
        {data.map((it, i) => (
          <Pressable key={it.id} onPress={() => setIndex(i)} hitSlop={8}>
            <View style={[styles.dot, i === index && styles.dotActive]} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width, height: HERO_H },
  dots: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: { backgroundColor: '#fff', width: 18 },
})
