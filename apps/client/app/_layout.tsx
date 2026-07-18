import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as ScreenOrientation from 'expo-screen-orientation'

export default function RootLayout() {
  // Portrait por defecto en toda la app — el player VLC (mkv) lo desbloquea
  // a horizontal mientras está montado y restaura esto al salir.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
    </GestureHandlerRootView>
  )
}
