import { Text, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { backdropUrl, type Category } from '@/lib/tmdb'
import { Touchable } from './Touchable'

export function CategoryCard({ cat, width }: { cat: Category; width: number }) {
  const router = useRouter()
  const img = backdropUrl(cat.backdrop_path, 'w780')

  return (
    <Touchable
      style={[styles.card, { width, height: width * 1.4 }]}
      haptic="light"
      onPress={() =>
        router.push({
          pathname: '/browse/[type]/[id]',
          params: { type: cat.type, id: String(cat.genreId), name: cat.name },
        })
      }
    >
      {img ? (
        <Image source={img} style={styles.img} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.img, styles.empty]} />
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.75)']}
        style={styles.grad}
      />
      <Text style={styles.name} numberOfLines={2}>
        {cat.name}
      </Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  img: { ...StyleSheet.absoluteFillObject },
  empty: { backgroundColor: '#1C1C1E' },
  grad: { ...StyleSheet.absoluteFillObject },
  name: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    right: 10,
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
})
