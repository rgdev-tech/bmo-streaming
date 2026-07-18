import { useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, Platform,
  KeyboardAvoidingView, ActivityIndicator, ScrollView,
} from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Touchable } from '@/components/Touchable'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
      // configurado en Supabase (Client IDs = com.rgdev.bmostreaming). No pasa
      // por el flujo OAuth web, por eso el Secret Key puede quedar vacío.
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: cred.identityToken,
      })
      if (error) throw error
    } catch (e: any) {
      // El usuario cancelando el diálogo no es un error que mostrar.
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(e?.message ?? 'No se pudo iniciar sesión con Apple')
      }
    } finally {
      setBusy(false)
    }
  }

  async function withEmail() {
    setError(null); setNotice(null)
    if (!email.trim() || password.length < 6) {
      setError('Escribe un correo y una contraseña de al menos 6 caracteres')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        // Con confirmación de correo activada no llega sesión: hay que avisar,
        // porque si no la pantalla se queda igual y parece que falló.
        if (!data.session) setNotice('Revisa tu correo para confirmar la cuenta.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#1a1a2e', '#000']} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>BMO</Text>
          <Text style={styles.tagline}>Tus series y películas, donde vayas.</Text>

          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={14}
              style={styles.appleBtn}
              onPress={withApple}
            />
          )}

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>o con tu correo</Text>
            <View style={styles.line} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Correo"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <Touchable style={styles.primaryBtn} scaleTo={0.97} haptic="medium" onPress={withEmail} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.primaryText}>{mode === 'signup' ? 'Crear cuenta' : 'Entrar'}</Text>}
          </Touchable>

          <Touchable
            style={styles.switchBtn}
            scaleTo={0.98}
            haptic="light"
            onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); setNotice(null) }}
          >
            <Text style={styles.switchText}>
              {mode === 'signup' ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear una'}
            </Text>
          </Touchable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  content: { paddingHorizontal: 28, alignItems: 'stretch' },
  brand: { color: '#fff', fontSize: 52, fontWeight: '900', letterSpacing: -2, textAlign: 'center' },
  tagline: {
    color: 'rgba(255,255,255,0.55)', fontSize: 15, textAlign: 'center',
    marginTop: 6, marginBottom: 44,
  },
  appleBtn: { height: 50, width: '100%' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 26 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
  dividerText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 15,
    color: '#fff', fontSize: 16, marginBottom: 12,
  },
  error: { color: '#ff6b6b', fontSize: 14, marginBottom: 10, textAlign: 'center' },
  notice: { color: '#6bd39a', fontSize: 14, marginBottom: 10, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#fff', borderRadius: 27,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    marginTop: 8, minHeight: 54,
  },
  primaryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  switchBtn: { marginTop: 20, alignItems: 'center' },
  switchText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
})
