import { useRef, useEffect, useMemo, useCallback, memo } from 'react'
import {
  FlatList,
  View,
  StyleSheet,
  Dimensions,
  Animated,
  type ListRenderItem,
} from 'react-native'
import { Hero } from './Hero'
import { type MediaItem } from '@/lib/tmdb'

const { width } = Dimensions.get('window')
const AUTO_MS = 6000

const HeroSlide = memo(Hero)

export function HeroCarousel({ items }: { items: MediaItem[] }) {
  const ref = useRef<FlatList<MediaItem>>(null)
  const scrollX = useRef(new Animated.Value(0)).current
  const dir = useRef(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const data = useMemo(
    () => items.filter((i) => i.backdrop_path).slice(0, 6),
    [items]
  )

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const schedule = useCallback(
    (from: number) => {
      clear()
      if (data.length < 2) return
      timer.current = setTimeout(() => {
        let next = from + dir.current
        if (next >= data.length) {
          dir.current = -1
          next = from - 1
        } else if (next < 0) {
          dir.current = 1
          next = from + 1
        }
        ref.current?.scrollToIndex({ index: next, animated: true })
      }, AUTO_MS)
    },
    [data.length, clear]
  )

  useEffect(() => {
    schedule(0)
    return clear
  }, [schedule, clear])

  const renderItem = useCallback<ListRenderItem<MediaItem>>(
    ({ item }) => <HeroSlide item={item} />,
    []
  )

  return (
    <View>
      <FlatList
        ref={ref}
        data={data}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => String(i.id)}
        renderItem={renderItem}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        onScrollBeginDrag={clear}
        onMomentumScrollEnd={(e) => {
          schedule(Math.round(e.nativeEvent.contentOffset.x / width))
        }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        decelerationRate="fast"
      />
      <View style={styles.dots}>
        {data.map((item, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width]
          const dotWidth = scrollX.interpolate({
            inputRange,
            outputRange: [6, 20, 6],
            extrapolate: 'clamp',
          })
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.3, 1, 0.3],
            extrapolate: 'clamp',
          })
          return (
            <Animated.View
              key={item.id}
              style={[styles.dot, { width: dotWidth, opacity }]}
            />
          )
        })}
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
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
})
