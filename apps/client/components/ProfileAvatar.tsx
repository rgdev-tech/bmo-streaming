import { View, Text, StyleSheet } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { resolveAvatar } from '@/lib/avatars'
import { colors } from '@/lib/theme'

// Avatar de perfil. Acepta la clave nueva ('aneka', 'bandit'...) o, para los
// perfiles creados antes del cambio, el emoji que quedó guardado en la base —
// así ninguno aparece en blanco mientras no se edite.
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
  const ring = selected
    ? { borderWidth: 3, borderColor: '#fff' }
    : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }

  if (!def) {
    // Legacy: lo guardado es un emoji (o algo desconocido).
    return (
      <View style={[styles.box, { width: size, height: size, borderRadius: size / 2 }, styles.legacy, ring]}>
        <Text style={{ fontSize: size * 0.42 }}>{avatar || '🍿'}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: size / 2 }, ring]}>
      <SvgXml xml={def.svg} width={size} height={size} />
    </View>
  )
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  legacy: { backgroundColor: 'rgba(255,255,255,0.09)' },
})
