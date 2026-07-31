import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { profileUrl, type MediaItem } from '@/lib/tmdb'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

// Traduce el departamento de TMDB (viene en inglés) a una etiqueta corta.
const DEPT_ES: Record<string, string> = {
  Acting: 'Actor / Actriz',
  Directing: 'Dirección',
  Writing: 'Guion',
  Production: 'Producción',
}

// Resultado de persona (actor) en el buscador → abre su filmografía.
export function PersonResultCard({ person }: { person: MediaItem }) {
  const router = useRouter()
  const img = profileUrl(person.profile_path ?? null, 'w185')
  const role = DEPT_ES[person.known_for_department ?? ''] ?? 'Intérprete'
  const knownFor = (person.known_for ?? [])
    .map((k) => k.title ?? k.name)
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ')

  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      style={styles.card}
      onPress={() => router.push(`/person/${person.id}` as never)}
    >
      {img ? (
        <Image source={img} style={styles.photo} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.photo, styles.empty]}>
          <Text style={styles.initials}>{(person.name ?? '?').charAt(0)}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{person.name}</Text>
        <Text style={styles.role} numberOfLines={1}>{role}</Text>
        {!!knownFor && <Text style={styles.knownFor} numberOfLines={1}>{knownFor}</Text>}
      </View>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.35)" style={styles.chevron} />
    </Touchable>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  photo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: 'rgba(255,255,255,0.5)', fontSize: 22, fontWeight: '700' },
  info: { flex: 1 },
  name: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  role: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  knownFor: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { width: 13, height: 13 },
})
