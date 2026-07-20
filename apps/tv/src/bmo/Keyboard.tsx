import { useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusScale } from './useFocusScale'
import { colors } from './theme'

const COLS = 6
// 38 y no 44: el teclado compite por ancho con lo que va al lado (la grilla de
// resultados en el buscador). A 38 dp siguen siendo cómodas de apuntar con la
// cruceta (76 px físicos en un panel 1080p).
const KEY = 38
const GAP = 6

export type KeyboardMode = 'upper' | 'lower' | 'symbols'

// Alfabético y no QWERTY a propósito: en TV el usuario no escribe de memoria
// como en un teclado físico, va buscando la letra con la vista. En orden
// alfabético la encuentra por descarte; en QWERTY tiene que barrer la grilla.
// Es lo que hacen Netflix y Prime Video en sus apps de televisor.
const UPPER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789']
const LOWER = [...'abcdefghijklmnopqrstuvwxyz', ...'0123456789']
// Los de arriba son los que aparecen en correos y contraseñas reales; el resto
// se descartó para no llenar la grilla de teclas que nadie va a usar.
const SYMBOLS = [...'@._-+!#$%&*()/:;?=,\'"~^[]{}<>|\\`']

const CHARS: Record<KeyboardMode, string[]> = {
  upper: UPPER,
  lower: LOWER,
  symbols: SYMBOLS,
}

function Key({
  label,
  span = 1,
  small,
  active,
  icon,
  hasTVPreferredFocus,
  onPress,
}: {
  label?: string
  /** Cuántas columnas ocupa la tecla. */
  span?: 1 | 2 | 3
  small?: boolean
  /** Modo actualmente activo — se marca para que el usuario sepa dónde está. */
  active?: boolean
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
      style={[styles.hit, span === 2 && styles.hit2, span === 3 && styles.hit3]}
    >
      {({ focused }) => (
        <Animated.View
          style={[
            styles.key,
            active && styles.keyActive,
            focused && styles.keyFocused,
            { transform: [{ scale }] },
          ]}
        >
          {icon ? (
            <Ionicons name={icon} size={18} color={focused ? '#000' : colors.text} />
          ) : (
            <Text
              style={[styles.label, small && styles.labelSmall, focused && styles.labelFocused]}
              numberOfLines={1}
            >
              {label}
            </Text>
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
 * pantalla, no un detalle estético.
 *
 * Los tres modos existen por las contraseñas: una contraseña real mezcla
 * mayúsculas, minúsculas y símbolos, y sin poder alternar no habría forma de
 * escribirla. Para buscar alcanzaría con uno solo.
 */
export function Keyboard({
  defaultMode = 'upper',
  onChar,
  onBackspace,
  onSpace,
  onClear,
}: {
  defaultMode?: KeyboardMode
  onChar: (c: string) => void
  onBackspace: () => void
  onSpace: () => void
  onClear: () => void
}) {
  const [mode, setMode] = useState<KeyboardMode>(defaultMode)
  const chars = CHARS[mode]

  return (
    <View style={styles.pad}>
      {chars.map((c, i) => (
        <Key
          key={`${mode}-${c}`}
          label={c}
          // El foco entra por la primera tecla: esquina superior izquierda, el
          // punto de partida que el ojo asume.
          hasTVPreferredFocus={i === 0}
          onPress={() => onChar(c)}
        />
      ))}

      {/* Fila de control. @ y . van como teclas propias aunque también estén en
          el modo símbolos: son los dos caracteres que TODO correo necesita, y
          esconderlos detrás de un cambio de modo obliga a descubrir el modo
          antes de poder escribir la primera dirección. */}
      <Key
        label={mode === 'upper' ? 'abc' : 'ABC'}
        small
        active={mode === 'upper'}
        onPress={() => setMode(mode === 'upper' ? 'lower' : 'upper')}
      />
      <Key label="@" onPress={() => onChar('@')} />
      <Key label="." onPress={() => onChar('.')} />
      <Key
        label="#+="
        small
        active={mode === 'symbols'}
        onPress={() => setMode(mode === 'symbols' ? 'lower' : 'symbols')}
      />
      <Key span={2} icon="remove-outline" onPress={onSpace} />

      <Key span={3} icon="backspace-outline" onPress={onBackspace} />
      <Key span={3} icon="close-outline" onPress={onClear} />
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
  // Las anchas suman el hueco que se comen entre columnas, para que la grilla
  // siga cuadrando y no queden teclas desalineadas al final.
  hit2: { width: KEY * 2 + GAP },
  hit3: { width: KEY * 3 + GAP * 2 },
  key: {
    flex: 1,
    borderRadius: 7,
    backgroundColor: 'rgba(120,120,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // El modo activo queda marcado en su propia tecla: sin esto, con dos toggles
  // independientes no hay forma de saber en cuál de los tres modos estás.
  keyActive: { backgroundColor: 'rgba(255,255,255,0.34)' },
  keyFocused: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  label: { fontSize: 17, fontWeight: '600', color: colors.text },
  labelSmall: { fontSize: 12, fontWeight: '700' },
  labelFocused: { color: '#000', fontWeight: '700' },
})
