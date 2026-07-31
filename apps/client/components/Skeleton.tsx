import { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet, Dimensions, type ViewStyle } from 'react-native'
import { colors } from '@/lib/theme'

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

// Una fila horizontal de posters (imita PosterRow) — reutilizable en otros skeletons
export function SkeletonRow() {
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

// Detalle de título (hero + botón + reparto) en esqueleto
export function TitleSkeleton() {
  return (
    <View style={styles.container}>
      <Skeleton style={styles.titleHero} />
      <View style={styles.titleBody}>
        <Skeleton style={styles.playBtn} />
        <View style={styles.secondaryRow}>
          <Skeleton style={styles.secondaryBtn} />
          <Skeleton style={styles.secondaryBtn} />
        </View>
        <Skeleton style={styles.line} />
        <Skeleton style={[styles.line, { width: '70%' }]} />
        <Skeleton style={[styles.line, { width: '85%' }]} />
      </View>
      <View style={styles.castRow}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} style={styles.castAvatar} />
        ))}
      </View>
    </View>
  )
}

// Perfil de persona (foto + bio + créditos) en esqueleto
export function PersonSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.personHeader}>
        <Skeleton style={styles.personPhoto} />
        <View style={styles.personInfo}>
          <Skeleton style={styles.personName} />
          <Skeleton style={styles.personMeta} />
        </View>
      </View>
      <View style={styles.personBio}>
        <Skeleton style={styles.line} />
        <Skeleton style={[styles.line, { width: '90%' }]} />
        <Skeleton style={[styles.line, { width: '60%' }]} />
      </View>
      <View style={styles.rows}>
        <SkeletonRow />
        <SkeletonRow />
      </View>
    </View>
  )
}

// Catálogo por proveedor (título + destacado + filas) en esqueleto
export function CatalogSkeleton() {
  return (
    <View style={styles.container}>
      <Skeleton style={styles.catalogTitle} />
      <Skeleton style={styles.catalogFeatured} />
      <View style={styles.rows}>
        <SkeletonRow />
        <SkeletonRow />
      </View>
    </View>
  )
}

const POSTER_W = 124
const { height } = Dimensions.get('window')

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, borderRadius: 8 },
  container: { flex: 1, backgroundColor: '#000' },
  hero: { width, height: height * 0.55, borderRadius: 0 },
  rows: { paddingTop: 20, gap: 28 },
  row: { gap: 12 },
  heading: { width: 160, height: 22, marginLeft: 20, borderRadius: 6 },
  posterRow: { flexDirection: 'row', gap: 12, paddingLeft: 20 },
  poster: { width: POSTER_W, height: POSTER_W * 1.5, borderRadius: 12 },

  // Title
  titleHero: { width, height: width * 0.95, borderRadius: 0 },
  titleBody: { paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  playBtn: { height: 48, borderRadius: 12 },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: { flex: 1, height: 44, borderRadius: 12 },
  line: { height: 14, borderRadius: 6, marginTop: 4 },
  castRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingTop: 28 },
  castAvatar: { width: 80, height: 80, borderRadius: 40 },

  // Person
  personHeader: { flexDirection: 'row', gap: 16, padding: 20, paddingTop: 12 },
  personPhoto: { width: 110, height: 165, borderRadius: 12 },
  personInfo: { flex: 1, justifyContent: 'center', gap: 8 },
  personName: { width: '70%', height: 22, borderRadius: 6 },
  personMeta: { width: '50%', height: 15, borderRadius: 6 },
  personBio: { paddingHorizontal: 20, gap: 8 },

  // Catalog
  catalogTitle: { width: 160, height: 34, borderRadius: 8, marginLeft: 20, marginTop: 12, marginBottom: 20 },
  catalogFeatured: { width: width - 40, height: (width - 40) * 0.56, borderRadius: 16, marginLeft: 20, marginBottom: 24 },
})
