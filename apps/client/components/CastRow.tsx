import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { type CastMember, profileUrl } from '@/lib/tmdb'

export function CastRow({ cast }: { cast: CastMember[] }) {
  const router = useRouter()
  const people = cast.slice(0, 15)
  if (!people.length) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Reparto</Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(c) => String(c.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const img = profileUrl(item.profile_path)
          return (
            <Pressable
              style={styles.person}
              onPress={() => router.push(`/person/${item.id}` as never)}
            >
              {img ? (
                <Image source={img} style={styles.photo} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.photo, styles.empty]}>
                  <Text style={styles.initials}>{item.name.charAt(0)}</Text>
                </View>
              )}
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.character} numberOfLines={1}>{item.character}</Text>
            </Pressable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  heading: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  list: { gap: 14 },
  person: { width: 80 },
  photo: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1C1C1E' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: 'rgba(255,255,255,0.5)', fontSize: 24, fontWeight: '700' },
  name: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  character: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
})
