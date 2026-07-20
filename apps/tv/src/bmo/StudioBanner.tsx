import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import type { StudioBrand } from '@bmo/core/studios'
import { useFocusScale } from './useFocusScale'
import { colors, layout } from './theme'

/**
 * Banner de marca en el buscador.
 *
 * Aparece cuando lo escrito coincide con un estudio conocido (Disney, Marvel,
 * DC…). El match es local e instantáneo: no espera a la red, así que el banner
 * ya está antes de que lleguen los resultados de TMDB.
 *
 * Cada marca trae su propio degradado; es lo único que la identifica, porque no
 * tenemos sus logos. Sin el color sería una tarjeta gris con texto.
 */
export function StudioBanner({
  brand,
  onPress,
}: {
  brand: StudioBrand
  onPress: (b: StudioBrand) => void
}) {
  // Escala chica: el banner ocupa todo el ancho, y un porcentaje que en un
  // póster no se nota acá se sale del contenedor y el borde queda recortado.
  const { scale, onFocus, onBlur } = useFocusScale(1.02)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress(brand)}>
      {({ focused }) => (
        <Animated.View
          style={[styles.wrap, focused && styles.wrapFocused, { transform: [{ scale }] }]}
        >
          <LinearGradient
            colors={brand.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.content}>
            <View>
              <Text style={styles.label}>Ver catálogo de</Text>
              <Text style={styles.name} numberOfLines={1}>
                {brand.name}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    height: 74,
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: 20,
  },
  wrapFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  label: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  name: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
})
