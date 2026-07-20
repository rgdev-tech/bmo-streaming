import { Slot } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { Sidebar } from '@/bmo/Sidebar'
import { colors } from '@/bmo/theme'

/**
 * Layout de las secciones principales. El rail vive acá y no en cada pantalla
 * para que no se remonte al cambiar de sección — si se remontara, perdería el
 * foco en cada navegación y el usuario quedaría sin cursor.
 *
 * Ficha y reproductor quedan fuera de este grupo a propósito: son pantallas de
 * inmersión, sin navegación global encima.
 */
export default function NavLayout() {
  return (
    <View style={styles.container}>
      <Sidebar />
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Fila: el rail es un hermano en el flujo, no una capa encima. Es lo que
  // permite que pulsar izquierda desde el catálogo llegue al menú — el motor de
  // foco de TV se mueve por geometría del layout.
  container: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  content: { flex: 1 },
})
