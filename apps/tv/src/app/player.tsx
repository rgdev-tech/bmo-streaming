import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FocusButton } from '@/bmo/FocusButton'
import { colors, heroTitle, rowHeading, safe } from '@/bmo/theme'

/**
 * MARCADOR — el reproductor de TV todavía no está implementado.
 *
 * Existe para que el flujo Home → Ficha → Reproducir sea recorrible de punta a
 * punta y se pueda probar la navegación con el control. Muestra a propósito los
 * parámetros que recibe, que son exactamente los que va a necesitar el
 * reproductor real.
 *
 * Lo que falta es trabajo de verdad, no cablear una vista: apps/client resuelve
 * la fuente con @bmo/core/stream y reproduce con expo-video (HLS) o con el fork
 * de VLC (mkv/archivo). Ese fork tiene código Android, pero nunca se compiló ni
 * se probó en Android TV.
 */
export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string
    id: string
    title?: string
    season?: string
    episode?: string
  }>()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reproductor pendiente</Text>
      <Text style={styles.subtitle}>
        Esta pantalla es un marcador. Todavía no hay reproducción en TV.
      </Text>

      <View style={styles.params}>
        <Text style={styles.paramLine}>título: {params.title || '—'}</Text>
        <Text style={styles.paramLine}>
          tipo: {params.type} · id: {params.id}
          {params.season ? ` · T${params.season}:E${params.episode}` : ''}
        </Text>
      </View>

      <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
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
    gap: 14,
  },
  title: heroTitle,
  subtitle: { ...rowHeading, fontWeight: '400', color: colors.textDim },
  params: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 4,
    marginBottom: 8,
  },
  paramLine: { fontSize: 13, color: colors.textDim, fontFamily: 'monospace' },
})
