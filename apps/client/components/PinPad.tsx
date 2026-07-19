import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import { Touchable } from './Touchable'

export const PIN_LENGTH = 4

// Teclado numérico propio en vez de un TextInput: el input del sistema abre el
// teclado completo (con predicciones y barra de pegado), que para 4 dígitos es
// ruidoso y se ve mal. Este ocupa alto fijo y no empuja el layout.
export function PinPad({
  value,
  onChange,
  title,
  subtitle,
  error,
}: {
  value: string
  onChange: (next: string) => void
  title: string
  subtitle?: string
  error?: string | null
}) {
  const shake = useRef(new Animated.Value(0)).current

  // Sacude los puntos al fallar. El error llega de afuera (el servidor decide),
  // así que se reacciona a su aparición.
  useEffect(() => {
    if (!error) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 45, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start()
  }, [error])

  function press(digit: string) {
    if (value.length >= PIN_LENGTH) return
    onChange(value + digit)
  }
  function back() {
    onChange(value.slice(0, -1))
  }

  const dots = { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) }] }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <Animated.View style={[styles.dots, dots]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotOn, !!error && styles.dotError]} />
        ))}
      </Animated.View>

      <Text style={styles.error}>{error ?? ' '}</Text>

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} />
        ))}
        {/* Hueco para alinear el 0 al centro, como el teclado del sistema */}
        <View style={styles.key} />
        <Key label="0" onPress={() => press('0')} />
        <Touchable
          style={styles.key}
          scaleTo={0.9}
          haptic="light"
          onPress={back}
          disabled={value.length === 0}
        >
          <SymbolView
            name="delete.left.fill"
            tintColor={value.length ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.2)'}
            style={styles.backIcon}
          />
        </Touchable>
      </View>
    </View>
  )
}

const Key = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Touchable style={[styles.key, styles.keyFilled]} scaleTo={0.92} haptic="selection" onPress={onPress}>
    <Text style={styles.keyText}>{label}</Text>
  </Touchable>
)

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  title: { color: '#fff', fontSize: 21, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  subtitle: {
    color: 'rgba(255,255,255,0.45)', fontSize: 14.5,
    marginTop: 7, textAlign: 'center', lineHeight: 20,
  },
  dots: { flexDirection: 'row', gap: 18, marginTop: 26 },
  dot: {
    width: 15, height: 15, borderRadius: 8,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.32)',
  },
  dotOn: { backgroundColor: '#fff', borderColor: '#fff' },
  dotError: { borderColor: '#ff6b6b' },
  // Altura reservada siempre: sin esto el teclado salta al aparecer el error.
  error: { color: '#ff6b6b', fontSize: 13.5, marginTop: 14, height: 18, textAlign: 'center' },

  pad: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 16, marginTop: 10, maxWidth: 268,
  },
  key: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  keyFilled: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  keyText: { color: '#fff', fontSize: 27, fontWeight: '500' },
  backIcon: { width: 25, height: 20 },
})
