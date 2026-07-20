import { useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'
import { colors } from './theme'

/**
 * Botón enfocable con la cruceta.
 *
 * Invierte el contraste al enfocarse (fondo blanco, texto negro) en vez de solo
 * agregarle un borde. En TV el usuario mira desde lejos y a veces de reojo: un
 * cambio de relleno se detecta con visión periférica, un borde de 2px no.
 *
 * `primary` es el estado en reposo del botón principal (Reproducir), que ya
 * viene claro; los secundarios arrancan translúcidos sobre el fondo.
 */
export function FocusButton({
  label,
  onPress,
  primary,
  hasTVPreferredFocus,
  style,
}: {
  label: string
  onPress?: () => void
  primary?: boolean
  hasTVPreferredFocus?: boolean
  style?: ViewStyle
}) {
  const scale = useRef(new Animated.Value(1)).current

  const animate = (to: number) => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start()
  }

  return (
    <Pressable
      onFocus={() => animate(1.06)}
      onBlur={() => animate(1)}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={style}
    >
      {({ focused }) => (
        <Animated.View
          style={[
            styles.button,
            primary && styles.primary,
            focused && styles.focused,
            { transform: [{ scale }] },
          ]}
        >
          <Text
            style={[
              styles.label,
              primary && styles.labelPrimary,
              focused && styles.labelFocused,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: 'rgba(120,120,128,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: 'rgba(255,255,255,0.9)' },
  focused: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  label: { fontSize: 15, fontWeight: '700', color: colors.text },
  labelPrimary: { color: '#000' },
  labelFocused: { color: '#000' },
})
