import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { profileUrl, type MediaItem } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
import { colors, layout } from './theme'

const PHOTO = 56

// TMDB devuelve el departamento en inglés; se traduce a una etiqueta corta.
const DEPT_ES: Record<string, string> = {
  Acting: 'Actor / Actriz',
  Directing: 'Dirección',
  Writing: 'Guion',
  Production: 'Producción',
}

/**
 * Resultado de persona en el buscador.
 *
 * Formato distinto al de los títulos —fila horizontal con foto redonda en vez
 * de póster— justamente para que se note que no es una película. Mezclarlos en
 * la misma cuadrícula obligaría a leer cada tarjeta para saber qué es.
 */
export function PersonResultCard({
  person,
  onPress,
}: {
  person: MediaItem
  onPress: (p: MediaItem) => void
}) {
  // Escala chica a propósito: la tarjeta ocupa casi todo el ancho disponible, y
  // un porcentaje que en un póster es imperceptible acá son varios píxeles que
  // se salen del contenedor y terminan recortados. El realce del foco lo llevan
  // el borde y el fondo, que no dependen del tamaño.
  const { scale, onFocus, onBlur } = useFocusScale(1.02)
  const img = profileUrl(person.profile_path ?? null, 'w185')
  const role = DEPT_ES[person.known_for_department ?? ''] ?? 'Intérprete'
  const knownFor = (person.known_for ?? [])
    .map((k) => k.title ?? k.name)
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ')

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress(person)}>
      {({ focused }) => (
        <Animated.View
          style={[styles.card, focused && styles.cardFocused, { transform: [{ scale }] }]}
        >
          {img ? (
            <Image source={img} style={styles.photo} contentFit="cover" transition={150} />
          ) : (
            <View style={[styles.photo, styles.empty]}>
              <Text style={styles.initials}>{(person.name ?? '?').charAt(0)}</Text>
            </View>
          )}
          <View style={styles.info}>
            <Text style={[styles.name, focused && styles.nameFocused]} numberOfLines={1}>
              {person.name}
            </Text>
            <Text style={styles.role} numberOfLines={1}>
              {knownFor ? `${role} · ${knownFor}` : role}
            </Text>
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 8,
    paddingRight: 18,
    borderRadius: layout.radius,
    backgroundColor: 'rgba(120,120,128,0.18)',
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: 10,
  },
  cardFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: 'rgba(120,120,128,0.32)',
  },
  photo: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    backgroundColor: colors.surface,
  },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textDim, fontSize: 22, fontWeight: '700' },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  nameFocused: { color: '#fff' },
  role: { fontSize: 12, color: colors.textDim, marginTop: 2 },
})
