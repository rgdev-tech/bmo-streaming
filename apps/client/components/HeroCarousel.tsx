import { useRef, useState, useEffect } from 'react'
import { FlatList, View, StyleSheet, Dimensions } from 'react-native'
import { Hero } from './Hero'
import { type MediaItem } from '@/lib/tmdb'

const { width } = Dimensions.get('window')

export function HeroCarousel({ items }: { items: MediaItem[] }) {
  const ref = useRef<FlatList<MediaItem>>(null)
  const [index, setIndex] = useState(0)
  const data = items.filter((i) => i.backdrop_path).slice(0, 6)

  // Auto-avance cada 6s
  useEffect(() => {
    if (data.length < 2) return
    const t = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % data.length
        ref.current?.scrollToIndex({ index: next, animated: true })
        return next
      })
    }, 6000)
    return () => clearInterval(t)
  }, [data.length])

  return (
    <View>
      <FlatList
        ref={ref}
        data={data}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => <Hero item={item} />}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />
      <View style={styles.dots}>
        {data.map((item, i) => (
          <View
            key={item.id}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dotActive: { backgroundColor: '#fff', width: 18 },
})
