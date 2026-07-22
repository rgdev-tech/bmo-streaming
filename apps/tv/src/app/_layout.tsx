import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { AuthProvider, useAuth } from '@bmo/core/auth'
import { supabaseConfigured } from '@bmo/core/supabase'
import { colors } from '@/bmo/theme'

// Mantener el splash NATIVO (negro + "BMO") hasta que montemos el splash JS
// animado por encima: así no hay parpadeo blanco entre el arranque nativo y el JS.
SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * Decide a dónde mandar al usuario según sesión y perfil. Mismo criterio que
 * apps/client: sin sesión → login; con sesión pero sin perfil → perfiles;
 * con ambos → contenido.
 *
 * Va como componente aparte y no dentro del layout para que sus re-render por
 * cambio de sesión no vuelvan a montar el Stack entero, que en TV significaría
 * perder el foco.
 */
function AuthGate() {
  const { loading, session, profile } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const onLogin = segments[0] === 'login'
    const onProfiles = segments[0] === 'profiles'

    if (!session) {
      if (!onLogin) router.replace('/login')
      return
    }
    // Con sesión pero sin perfil activo hay que elegir uno: todas las escrituras
    // cuelgan de profile_id y sin él fallarían por RLS.
    if (!profile) {
      if (!onProfiles) router.replace('/profiles')
      return
    }
    // Ya autenticado y con perfil: sacarlo del login.
    //
    // A /profiles NO se lo saca: con perfil activo sigue siendo una pantalla
    // legítima, es como se cambia de perfil desde el rail. Incluirla acá hacía
    // que entrar a cambiar de perfil rebotara al inicio en el acto.
    if (onLogin) router.replace('/')
  }, [loading, session, profile, segments, router])

  return null
}

function RootNavigator() {
  const { loading } = useAuth()

  // Mientras se restaura la sesión no se puede decidir a dónde mandar al
  // usuario sin hacerlo parpadear entre login y contenido.
  if (loading && supabaseConfigured) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    )
  }

  return (
    <>
      <AuthGate />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  )
}

/**
 * Splash de marca animado. Continúa el splash NATIVO (negro + "BMO") y hace la
 * SALIDA: el logo escala suave y toda la capa se desvanece hacia la app. Da la
 * sensación de app nativa en vez del splash azul de Expo. Como dibuja el mismo
 * logo que el nativo, ocultar el nativo al montar no genera parpadeo.
 */
function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const overlay = useRef(new Animated.Value(1)).current
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {})
    Animated.sequence([
      Animated.delay(450),
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.16, duration: 650, useNativeDriver: true }),
        Animated.timing(overlay, { toValue: 0, duration: 650, useNativeDriver: true }),
      ]),
    ]).start(() => onDone())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.brandSplash, { opacity: overlay }]}
      pointerEvents="none"
    >
      <Animated.Image
        source={require('../../assets/images/splash-bmo.png')}
        resizeMode="contain"
        style={[styles.brandLogo, { transform: [{ scale }] }]}
      />
    </Animated.View>
  )
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false)

  return (
    <AuthProvider>
      <StatusBar hidden />
      <RootNavigator />
      {!splashDone && <AnimatedSplash onDone={() => setSplashDone(true)} />}
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandSplash: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: { width: 260, height: 110 },
})
