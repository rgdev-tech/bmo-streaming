import { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet, Dimensions, type ViewStyle } from 'react-native'

const { width } = Dimensions.get('window')

// Bloque base con pulso animado
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  return <Animated.View style={[styles.block, style, { opacity }]} />
}

// Una fila horizontal de posters (imita PosterRow)
function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton style={styles.heading} />
      <View style={styles.posterRow}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} style={styles.poster} />
        ))}
      </View>
    </View>
  )
}

// Pantalla de inicio completa en esqueleto
export function HomeSkeleton() {
  return (
    <View style={styles.container}>
      <Skeleton style={styles.hero} />
      <View style={styles.rows}>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </View>
    </View>
  )
}

const POSTER_W = 124

const styles = StyleSheet.create({
  block: { backgroundColor: '#1C1C1E', borderRadius: 8 },
  container: { flex: 1, backgroundColor: '#000' },
  hero: { width, height: Dimensions.get('window').height * 0.55, borderRadius: 0 },
  rows: { paddingTop: 20, gap: 28 },
  row: { gap: 12 },
  heading: { width: 160, height: 22, marginLeft: 20, borderRadius: 6 },
  posterRow: { flexDirection: 'row', gap: 12, paddingLeft: 20 },
  poster: { width: POSTER_W, height: POSTER_W * 1.5, borderRadius: 12 },
})
