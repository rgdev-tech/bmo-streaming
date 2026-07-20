import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusScale } from './useFocusScale'
import { colors, layout, rowHeading } from './theme'

export const PIN_LENGTH = 4

const KEY = 62
const GAP = 10

function PinKey({
  digit,
  icon,
  hasTVPreferredFocus,
  onPress,
}: {
  digit?: string
  icon?: keyof typeof Ionicons.glyphMap
  hasTVPreferredFocus?: boolean
  onPress: () => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.1)

  return (
    <Pressable
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={styles.hit}
    >
      {({ focused }) => (
        <Animated.View
          style={[styles.key, focused && styles.keyFocused, { transform: [{ scale }] }]}
        >
          {icon ? (
            <Ionicons name={icon} size={22} color={focused ? '#000' : colors.text} />
          ) : (
            <Text style={[styles.digit, focused && styles.digitFocused]}>{digit}</Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  )
}

/**
 * Pad numérico para el PIN de perfil.
 *
 * Grilla de 3 columnas y no una fila: con la cruceta, llegar del 1 al 9 en una
 * fila son ocho pulsaciones; en grilla, dos. Los dígitos son lo único que se
 * escribe acá, así que no hace falta el teclado completo.
 */
export function PinPad({
  value,
  onChange,
  title,
  subtitle,
  error,
}: {
  value: string
  onChange: (v: string) => void
  title: string
  subtitle?: string
  error?: string | null
}) {
  function push(d: string) {
    if (value.length >= PIN_LENGTH) return
    onChange(value + d)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      {/* Puntos de progreso: con los dígitos ocultos son la única señal de
          cuántos van. Sin esto el usuario no sabe si registró la pulsación. */}
      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d, i) => (
          <PinKey key={d} digit={d} hasTVPreferredFocus={i === 0} onPress={() => push(d)} />
        ))}
        {/* Hueco a la izquierda del 0 para que quede centrado bajo el 8, como
            en cualquier teclado numérico. */}
        <View style={styles.hit} />
        <PinKey digit="0" onPress={() => push('0')} />
        <PinKey icon="backspace-outline" onPress={() => onChange(value.slice(0, -1))} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  title: { ...rowHeading, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textDim, marginBottom: 16 },
  dots: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  dot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  dotFilled: { backgroundColor: colors.text, borderColor: colors.text },
  error: { fontSize: 13, color: '#FF6B6B', marginBottom: 10 },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    width: KEY * 3 + GAP * 2,
    justifyContent: 'center',
  },
  hit: { width: KEY, height: KEY },
  key: {
    flex: 1,
    borderRadius: layout.radius,
    backgroundColor: 'rgba(120,120,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyFocused: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  digit: { fontSize: 24, fontWeight: '600', color: colors.text },
  digitFocused: { color: '#000', fontWeight: '700' },
})
