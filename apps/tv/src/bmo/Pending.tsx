import { StyleSheet, Text, View } from 'react-native'
import { colors, heroTitle, safe } from './theme'

/**
 * Marcador de sección todavía no construida. Dice qué falta y por qué, en vez
 * de mostrar una pantalla vacía que se confunda con un error o con una carga
 * colgada.
 */
export function Pending({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: safe.horizontal,
    gap: 12,
  },
  title: heroTitle,
  detail: {
    fontSize: 16,
    color: colors.textDim,
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 24,
  },
})
