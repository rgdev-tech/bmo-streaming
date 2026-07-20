import { StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { resolveAvatar } from '@bmo/core/avatars'
import { colors } from './theme'

/**
 * Avatar de perfil. Acepta la clave nueva ('aneka', 'bandit'…) o, para los
 * perfiles creados antes del cambio, el emoji que quedó guardado en la base —
 * así ninguno aparece en blanco mientras no se edite.
 */
export function ProfileAvatar({
  avatar,
  size,
  selected = false,
}: {
  avatar: string | null | undefined
  size: number
  selected?: boolean
}) {
  const def = resolveAvatar(avatar)
  const radius = Math.round(size * 0.16)

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: radius },
        selected ? styles.selected : styles.idle,
      ]}
    >
      {def ? (
        <SvgXml xml={def.svg} width={size} height={size} />
      ) : (
        // Sin definición conocida se cae al texto guardado (suele ser un emoji
        // de los perfiles viejos) antes que dejar el cuadro vacío.
        <Text style={[styles.fallback, { fontSize: size * 0.45 }]}>{avatar || '?'}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  idle: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)' },
  selected: { borderWidth: 3, borderColor: colors.focusBorder },
  fallback: { color: colors.text },
})
