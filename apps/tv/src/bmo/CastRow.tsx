import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { profileUrl, type CastMember } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
import { colors, rowHeading, safe } from './theme'

const PHOTO = 88

/**
 * Reparto con fotos circulares.
 *
 * El círculo no es capricho estético: las fotos de perfil de TMDB vienen
 * encuadradas al rostro y en proporciones dispares, así que un recorte circular
 * centrado se lleva bien con todas. Un rectángulo dejaría a la vista los
 * encuadres malos.
 *
 * Cada persona es enfocable aunque todavía no lleve a ningún lado: la pantalla
 * de persona no existe en TV. Se deja el onPress abierto para cuando exista.
 */
function CastCard({
  person,
  onPress,
}: {
  person: CastMember
  onPress?: (p: CastMember) => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.1)
  const img = profileUrl(person.profile_path)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress?.(person)} style={styles.hit}>
      {({ focused }) => (
        <Animated.View style={[styles.person, { transform: [{ scale }] }]}>
          <View style={[styles.photoWrap, focused && styles.photoWrapFocused]}>
            {img ? (
              <Image source={img} style={styles.photo} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.photo, styles.empty]}>
                <Text style={styles.initials}>{person.name.charAt(0)}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.name, focused && styles.nameFocused]} numberOfLines={1}>
            {person.name}
          </Text>
          {!!person.character && (
            <Text style={styles.character} numberOfLines={1}>
              {person.character}
            </Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  )
}

export function CastRow({
  cast,
  onPressPerson,
}: {
  cast: CastMember[]
  onPressPerson?: (p: CastMember) => void
}) {
  const people = cast?.slice(0, 15) ?? []
  if (!people.length) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Reparto</Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => <CastCard person={item} onPress={onPressPerson} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={8}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginBottom: 30 },
  heading: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: safe.horizontal,
  },
  list: { paddingHorizontal: safe.horizontal, paddingVertical: 10 },
  hit: { marginRight: 22 },
  person: { width: PHOTO, alignItems: 'center' },
  photoWrap: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    overflow: 'hidden',
    borderWidth: 2,
    // Borde transparente siempre presente para que al enfocar no se corra nada.
    borderColor: 'transparent',
  },
  photoWrapFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  photo: { width: '100%', height: '100%', backgroundColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textDim, fontSize: 30, fontWeight: '700' },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  nameFocused: { color: '#fff' },
  character: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
})
