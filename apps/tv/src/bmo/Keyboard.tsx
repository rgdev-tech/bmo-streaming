import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusScale } from './useFocusScale'
import { colors } from './theme'

const COLS = 6
// 38 y no 44: el teclado compite por ancho con la grilla de resultados, y con
// teclas más grandes la cuarta columna de pósters no entra. A 38 dp siguen
// siendo cómodas de apuntar con la cruceta (76 px físicos en un panel 1080p).
const KEY = 38
const GAP = 6

// Alfabético y no QWERTY a propósito: en TV el usuario no escribe de memoria
// como en un teclado físico, va buscando la letra con la vista. En orden
// alfabético la encuentra por descarte; en QWERTY tiene que barrer toda la
// grilla. Es lo que hacen Netflix y Prime Video en sus apps de televisor.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')
const CHARS = [...LETTERS, ...DIGITS]

function Key({
  label,
  wide,
  icon,
  hasTVPreferredFocus,
  onPress,
}: {
  label?: string
  wide?: boolean
  icon?: keyof typeof Ionicons.glyphMap
  hasTVPreferredFocus?: boolean
  onPress: () => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.12)

  return (
    <Pressable
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.hit, wide && styles.hitWide]}
    >
      {({ focused }) => (
        <Animated.View
          style={[styles.key, wide && styles.keyWide, focused && styles.keyFocused, { transform: [{ scale }] }]}
        >
          {icon ? (
            <Ionicons name={icon} size={18} color={focused ? '#000' : colors.text} />
          ) : (
            <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
          )}
        </Animated.View>
      )}
    </Pressable>
  )
}

/**
 * Teclado en pantalla navegable con la cruceta.
 *
 * Es la única forma de escribir en un televisor: no hay tacto ni teclado
 * físico. Cada tecla es un elemento enfocable y el usuario recorre la grilla
 * con las flechas, así que el orden de las teclas ES la ergonomía de la
 * pantalla — no un detalle estético.
 */
export function Keyboard({
  onChar,
  onBackspace,
  onSpace,
  onClear,
}: {
  onChar: (c: string) => void
  onBackspace: () => void
  onSpace: () => void
  onClear: () => void
}) {
  return (
    <View style={styles.pad}>
      {CHARS.map((c, i) => (
        <Key
          key={c}
          label={c}
          // El foco entra por la primera tecla: es la esquina superior
          // izquierda, el punto de partida que el ojo asume.
          hasTVPreferredFocus={i === 0}
          onPress={() => onChar(c)}
        />
      ))}

      <Key label="espacio" wide icon="remove-outline" onPress={onSpace} />
      <Key label="borrar" wide icon="backspace-outline" onPress={onBackspace} />
      <Key label="limpiar" wide icon="close-outline" onPress={onClear} />
    </View>
  )
}

const styles = StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    width: COLS * KEY + (COLS - 1) * GAP,
  },
  hit: { width: KEY, height: KEY },
  // Las anchas ocupan dos columnas más el hueco entre ellas, para que la grilla
  // siga cuadrando y no queden teclas desalineadas al final.
  hitWide: { width: KEY * 2 + GAP },
  key: {
    flex: 1,
    borderRadius: 7,
    backgroundColor: 'rgba(120,120,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: {},
  keyFocused: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  label: { fontSize: 17, fontWeight: '600', color: colors.text },
  labelFocused: { color: '#000', fontWeight: '700' },
})
