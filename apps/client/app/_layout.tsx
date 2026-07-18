import { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as ScreenOrientation from 'expo-screen-orientation'
import { AuthProvider, useAuth } from '@/lib/auth'
import { supabaseConfigured } from '@/lib/supabase'

// Decide a dónde va el usuario según sesión y perfil elegido. Vive dentro del
// provider (necesita useAuth) y se renderiza como hermano del Stack para no
// re-montar la navegación en cada cambio de estado.
function AuthGate() {
  const { loading, session, profiles, profile } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    // Sin Supabase configurado la app sigue funcionando como antes (sin
    // cuentas): mejor eso que dejarla trabada en una pantalla de login que no
    // puede resolver nada.
    if (loading || !supabaseConfigured) return

    const route = segments[0]
    const onLogin = route === 'login'
    const onProfiles = route === 'profiles'

    if (!session) {
      if (!onLogin) router.replace('/login')
      return
    }
    // Con sesión pero sin perfil activo hay que elegir uno: todas las
    // escrituras cuelgan de profile_id y sin él fallarían por RLS.
    if (!profile) {
      if (!onProfiles) router.replace('/profiles')
      return
    }
    // Ya autenticado y con perfil: sacarlo de las pantallas de entrada.
    if (onLogin) router.replace('/')
  }, [loading, session, profile, profiles.length, segments, router])

  return null
}

function RootNavigator() {
  const { loading } = useAuth()

  if (loading && supabaseConfigured) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#fff" />
      </View>
    )
  }

  return (
    <>
      <AuthGate />
      <Stack screenOptions={{ contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="profiles" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="title/[type]/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="person/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="browse/[type]/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="studio/[key]" options={{ headerShown: false }} />
        <Stack.Screen
          name="player"
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            animation: 'fade',
          }}
        />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  // Portrait por defecto en toda la app — el player lo desbloquea a horizontal
  // mientras está montado y restaura esto al salir.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
})
