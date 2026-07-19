import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, Platform, Animated, Easing,
  KeyboardAvoidingView, ActivityIndicator, ScrollView,
} from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Touchable } from '@/components/Touchable'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6

export default function LoginScreen() {
  const insets = useSafeAreaInsets()

  // Dos condiciones para mostrar el botón de Apple:
  //
  //  1. El flag de entorno. `isAvailableAsync()` solo verifica que el módulo
  //     nativo y la versión de iOS lo soporten — NO ve la entitlement. Sin
  //     `com.apple.developer.applesignin` el diálogo abre igual y falla con
  //     "authorization attempt failed for an unknown reason", así que sin este
  //     flag tendríamos un botón que siempre falla. Se activa cuando el App ID
  //     `com.rgdev.bmostreaming` esté registrado con Sign in with Apple
  //     (los App ID comodín no admiten esa capacidad).
  //  2. Que el módulo nativo esté realmente en el binario: si la app se compiló
  //     sin él, el componente se pinta como un recuadro rojo de "Unimplemented
  //     component" y tapa el login por correo, que sí funciona.
  const appleEnabled = process.env.EXPO_PUBLIC_ENABLE_APPLE_AUTH === '1'
  const [appleReady, setAppleReady] = useState(false)
  useEffect(() => {
    if (!appleEnabled) return
    let alive = true
    AppleAuthentication.isAvailableAsync()
      .then((ok) => alive && setAppleReady(ok))
      .catch(() => alive && setAppleReady(false))
    return () => { alive = false }
  }, [appleEnabled])

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [focused, setFocused] = useState<'email' | 'password' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const passwordRef = useRef<TextInput>(null)

  // El CTA se habilita solo cuando los datos sirven — evita el viaje a la red
  // (y el error) por un correo mal escrito.
  const canSubmit = useMemo(
    () => EMAIL_RE.test(email.trim()) && password.length >= MIN_PASSWORD,
    [email, password]
  )

  // Entrada escalonada: el bloque sube y aparece. Le da peso a la pantalla sin
  // que se sienta lenta.
  const enter = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start()
  }, [])
  const rise = (delay: number) => ({
    opacity: enter,
    transform: [{
      translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14 + delay, 0] }),
    }],
  })

  // Sacudida horizontal al fallar: feedback físico, no solo texto rojo.
  const shake = useRef(new Animated.Value(0)).current
  function fail(msg: string) {
    setError(msg)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 45, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start()
  }
  const shakeStyle = {
    transform: [{
      translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }),
    }],
  }

  // No hace falta navegar al terminar: onAuthStateChange en AuthProvider
  // actualiza la sesión y el guard del layout raíz redirige solo.
  async function withApple() {
    setError(null)
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (!cred.identityToken) throw new Error('Apple no devolvió token')
      setBusy(true)
      // Login NATIVO: se valida el identityToken contra el bundle id
      // configurado en Supabase. No pasa por el flujo OAuth web, por eso el
      // Secret Key puede quedar vacío.
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple', token: cred.identityToken,
      })
      if (error) throw error
    } catch (e: any) {
      // El usuario cancelando el diálogo no es un error que mostrar.
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        fail(e?.message ?? 'No se pudo iniciar sesión con Apple')
      }
    } finally {
      setBusy(false)
    }
  }

  async function withEmail() {
    if (!canSubmit || busy) return
    setError(null); setNotice(null); setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        // Con confirmación de correo activada no llega sesión: hay que avisar,
        // porque si no la pantalla se queda igual y parece que falló.
        if (!data.session) {
          setNotice('Te enviamos un correo para confirmar la cuenta.')
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e: any) {
      fail(translateAuthError(e?.message))
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(mode === 'signup' ? 'signin' : 'signup')
    setError(null); setNotice(null)
  }

  const isSignup = mode === 'signup'

  return (
    <View style={styles.root}>
      {/* Dos capas: degradado base + halo superior. El halo evita que el fondo
          se vea plano detrás del logo. */}
      <LinearGradient colors={['#171733', '#0B0B18', '#000']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(90,90,190,0.30)', 'transparent']}
        style={styles.halo}
        pointerEvents="none"
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.header, rise(0)]}>
            <Text style={styles.brand}>BMO</Text>
            <Text style={styles.title}>{isSignup ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}</Text>
            <Text style={styles.subtitle}>
              {isSignup
                ? 'Tu lista y tu progreso, en todos tus dispositivos.'
                : 'Continúa donde lo dejaste.'}
            </Text>
          </Animated.View>

          {appleReady && (
            <Animated.View style={rise(4)}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={14}
                style={styles.appleBtn}
                onPress={withApple}
              />
              <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.dividerText}>o con tu correo</Text>
                <View style={styles.line} />
              </View>
            </Animated.View>
          )}

          {/* Campos agrupados en una sola tarjeta con separador fino — el
              patrón de los formularios de iOS, en vez de dos cajas sueltas. */}
          <Animated.View style={[rise(8), shakeStyle]}>
            <View style={styles.group}>
              <Field
                icon="envelope.fill"
                placeholder="Correo"
                value={email}
                onChangeText={setEmail}
                focused={focused === 'email'}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <View style={styles.separator} />
              <Field
                ref={passwordRef}
                icon="lock.fill"
                placeholder="Contraseña"
                value={password}
                onChangeText={setPassword}
                focused={focused === 'password'}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                secureTextEntry={!showPassword}
                textContentType={isSignup ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={withEmail}
                accessory={
                  <Touchable
                    scaleTo={0.85}
                    haptic="selection"
                    hitSlop={10}
                    onPress={() => setShowPassword((v) => !v)}
                  >
                    <SymbolView
                      name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
                      tintColor="rgba(255,255,255,0.4)"
                      style={styles.eye}
                    />
                  </Touchable>
                }
              />
            </View>

            {/* Pista de requisito, solo al crear cuenta y mientras falte */}
            {isSignup && password.length > 0 && password.length < MIN_PASSWORD && (
              <Text style={styles.hint}>La contraseña necesita al menos {MIN_PASSWORD} caracteres.</Text>
            )}

            {!!error && (
              <View style={styles.banner}>
                <SymbolView name="exclamationmark.circle.fill" tintColor="#ff6b6b" style={styles.bannerIcon} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            {!!notice && (
              <View style={styles.banner}>
                <SymbolView name="checkmark.circle.fill" tintColor="#6bd39a" style={styles.bannerIcon} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}
          </Animated.View>

          <Animated.View style={rise(12)}>
            <Touchable
              style={[styles.primaryBtn, !canSubmit && styles.primaryBtnOff]}
              scaleTo={0.97}
              haptic="medium"
              onPress={withEmail}
              disabled={!canSubmit || busy}
            >
              {busy
                ? <ActivityIndicator color="#000" />
                : (
                  <Text style={[styles.primaryText, !canSubmit && styles.primaryTextOff]}>
                    {isSignup ? 'Crear cuenta' : 'Entrar'}
                  </Text>
                )}
            </Touchable>

            <Touchable style={styles.switchBtn} scaleTo={0.98} haptic="light" onPress={switchMode}>
              <Text style={styles.switchText}>
                {isSignup ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
                <Text style={styles.switchLink}>{isSignup ? 'Entrar' : 'Crear una'}</Text>
              </Text>
            </Touchable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// ── Campo de la tarjeta agrupada ────────────────────────────────────────────

type FieldProps = React.ComponentProps<typeof TextInput> & {
  icon: string
  focused: boolean
  accessory?: React.ReactNode
}

const Field = ({ ref, icon, focused, accessory, ...rest }: FieldProps & { ref?: React.Ref<TextInput> }) => (
  <View style={[styles.field, focused && styles.fieldFocused]}>
    <SymbolView
      name={icon as any}
      tintColor={focused ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.32)'}
      style={styles.fieldIcon}
    />
    <TextInput
      ref={ref}
      style={styles.input}
      placeholderTextColor="rgba(255,255,255,0.3)"
      autoCapitalize="none"
      autoCorrect={false}
      selectionColor="#fff"
      {...rest}
    />
    {accessory}
  </View>
)

// Supabase responde en inglés; estos son los casos que el usuario ve de verdad.
function translateAuthError(msg?: string): string {
  const m = (msg ?? '').toLowerCase()
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.'
  if (m.includes('already registered')) return 'Ese correo ya tiene una cuenta.'
  if (m.includes('email not confirmed')) return 'Confirma tu correo antes de entrar.'
  if (m.includes('network')) return 'Sin conexión. Revisa tu internet.'
  return msg || 'No se pudo iniciar sesión.'
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  halo: { position: 'absolute', top: -140, left: -90, right: -90, height: 460, borderRadius: 999 },
  content: { paddingHorizontal: 26 },

  header: { alignItems: 'center', marginBottom: 40 },
  brand: { color: '#fff', fontSize: 46, fontWeight: '900', letterSpacing: -2.2 },
  title: {
    color: '#fff', fontSize: 25, fontWeight: '700',
    letterSpacing: -0.6, marginTop: 22, textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)', fontSize: 15,
    marginTop: 7, textAlign: 'center', lineHeight: 21,
  },

  appleBtn: { height: 52, width: '100%' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.16)' },
  dividerText: { color: 'rgba(255,255,255,0.38)', fontSize: 13 },

  // Tarjeta única con separador: menos ruido visual que dos campos flotando.
  group: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 11, height: 56 },
  fieldFocused: { backgroundColor: 'rgba(255,255,255,0.05)' },
  fieldIcon: { width: 17, height: 17 },
  input: { flex: 1, color: '#fff', fontSize: 16.5, height: '100%' },
  eye: { width: 18, height: 18 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginLeft: 43, // arranca después del icono, como las listas de iOS
  },

  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 10, marginLeft: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 2 },
  bannerIcon: { width: 15, height: 15 },
  errorText: { color: '#ff6b6b', fontSize: 14, flex: 1, lineHeight: 19 },
  noticeText: { color: '#6bd39a', fontSize: 14, flex: 1, lineHeight: 19 },

  primaryBtn: {
    backgroundColor: '#fff', borderRadius: 28,
    paddingVertical: 17, alignItems: 'center', justifyContent: 'center',
    marginTop: 26, minHeight: 56,
  },
  // Deshabilitado en vez de oculto: el usuario ve el objetivo y qué le falta.
  primaryBtnOff: { backgroundColor: 'rgba(255,255,255,0.14)' },
  primaryText: { color: '#000', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  primaryTextOff: { color: 'rgba(255,255,255,0.45)' },

  switchBtn: { marginTop: 22, alignItems: 'center', paddingVertical: 6 },
  switchText: { color: 'rgba(255,255,255,0.5)', fontSize: 14.5 },
  switchLink: { color: '#fff', fontWeight: '600' },
})
