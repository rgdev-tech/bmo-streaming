import { useMemo, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { supabase } from '@bmo/core/supabase'
import { Keyboard } from '@/bmo/Keyboard'
import { FocusButton } from '@/bmo/FocusButton'
import { useFocusScale } from '@/bmo/useFocusScale'
import { colors, heroTitle, layout, safe } from '@/bmo/theme'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6

type Field = 'email' | 'password'

/**
 * Campo de texto de TV. No es un TextInput: no hay teclado del sistema ni
 * cursor. Es un destino enfocable que, al seleccionarse, se vuelve el objetivo
 * de lo que se escriba en el teclado en pantalla.
 */
function FieldBox({
  label,
  value,
  masked,
  active,
  onPress,
}: {
  label: string
  value: string
  masked?: boolean
  active: boolean
  onPress: () => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.02)
  const shown = masked ? '•'.repeat(value.length) : value

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={onPress}>
      {({ focused }) => (
        <Animated.View
          style={[
            styles.field,
            active && styles.fieldActive,
            focused && styles.fieldFocused,
            { transform: [{ scale }] },
          ]}
        >
          <Text style={styles.fieldLabel}>{label}</Text>
          <View style={styles.fieldValueRow}>
            <Text style={[styles.fieldValue, !value && styles.fieldEmpty]} numberOfLines={1}>
              {shown || '—'}
            </Text>
            {/* El cursor marca cuál de los dos campos recibe lo que se teclea.
                Sin esto el usuario escribe a ciegas sin saber dónde va a caer. */}
            {active && <View style={styles.caret} />}
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState<Field>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = useMemo(
    () => EMAIL_RE.test(email.trim()) && password.length >= MIN_PASSWORD,
    [email, password]
  )

  function write(fn: (s: string) => string) {
    setError(null)
    if (target === 'email') setEmail(fn)
    else setPassword(fn)
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      // Igual que apps/client: se llama a Supabase directo, no por el contexto
      // de auth (AuthState no expone signIn). El provider detecta el cambio de
      // sesión por su listener y redirige solo.
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      // Se muestra el mensaje de Supabase tal cual en vez de inventar uno que
      // oculte la causa real (correo sin confirmar, credenciales mal, etc).
      if (err) setError(err.message)
    } catch {
      setError('No pude conectar. Revisá la red.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Keyboard
          // Minúsculas por defecto: los correos van en minúscula y es lo primero
          // que se escribe. Para la contraseña se alterna con la tecla de modo.
          defaultMode="lower"
          onChar={(c) => write((s) => s + c)}
          onBackspace={() => write((s) => s.slice(0, -1))}
          onSpace={() => write((s) => (s ? s + ' ' : s))}
          onClear={() => write(() => '')}
        />
      </View>

      <View style={styles.right}>
        <Text style={styles.title}>Iniciar sesión</Text>
        <Text style={styles.hint}>
          Elegí un campo con el control y escribí con el teclado de la izquierda.
        </Text>

        <FieldBox
          label="Correo"
          value={email}
          active={target === 'email'}
          onPress={() => setTarget('email')}
        />
        <FieldBox
          label="Contraseña"
          value={password}
          masked
          active={target === 'password'}
          onPress={() => setTarget('password')}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.actions}>
          {busy ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <FocusButton label="Entrar" primary onPress={submit} />
          )}
        </View>

        {!valid && !error && (
          <Text style={styles.requisites}>
            Hace falta un correo válido y una contraseña de al menos {MIN_PASSWORD} caracteres.
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
    paddingTop: safe.top,
    paddingHorizontal: safe.horizontal,
    gap: 44,
  },
  left: { width: 258 },
  right: { flex: 1, paddingTop: 4 },
  title: { ...heroTitle, fontSize: 34, marginBottom: 6 },
  hint: { fontSize: 13, color: colors.textDim, marginBottom: 22 },

  field: {
    borderRadius: layout.radius,
    backgroundColor: 'rgba(120,120,128,0.2)',
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  // Activo = destino de lo que se escribe. Enfocado = dónde está el cursor del
  // control. Son cosas distintas y por eso se marcan distinto.
  fieldActive: { backgroundColor: 'rgba(120,120,128,0.34)' },
  fieldFocused: { borderColor: colors.focusBorder },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textDim, marginBottom: 3 },
  fieldValueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  fieldValue: { fontSize: 19, fontWeight: '600', color: colors.text, flexShrink: 1 },
  fieldEmpty: { color: 'rgba(235,235,245,0.3)' },
  caret: { width: 2, height: 21, backgroundColor: colors.text },

  error: { fontSize: 13, color: '#FF6B6B', marginTop: 6, marginBottom: 4 },
  actions: { flexDirection: 'row', marginTop: 14 },
  requisites: { fontSize: 12, color: colors.textDim, marginTop: 12 },
})
