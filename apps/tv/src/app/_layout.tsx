import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { colors } from '@/bmo/theme'

/**
 * Stack sin cabecera. El template traía NativeTabs (Home/Explore/Events), que
 * son pantallas de demo de Expo: se reemplazan por un stack plano hasta que
 * definamos la navegación real de BMO (Inicio, Películas, Series, Búsqueda).
 *
 * En TV la navegación no puede ser una barra de tabs táctil como en el teléfono;
 * tiene que ser un menú recorrible con la cruceta. Eso es diseño aparte, así que
 * por ahora hay una sola pantalla.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar hidden />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  )
}
