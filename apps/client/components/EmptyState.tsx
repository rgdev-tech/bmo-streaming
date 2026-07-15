import { View, Text, StyleSheet } from 'react-native'
import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { Touchable } from './Touchable'

// Estado vacío / error consistente: ícono + título + subtítulo + acción opcional.
// El contenedor no fija su propio layout (flex/centrado vertical) — lo decide
// quien lo use, según si va dentro de un ScrollView o llena la pantalla.
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: SymbolViewProps['name']
  title: string
  subtitle?: string
  action?: { label: string; onPress: () => void }
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <SymbolView name={icon} tintColor="rgba(255,255,255,0.5)" style={styles.icon} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action && (
        <Touchable scaleTo={0.95} haptic="light" style={styles.actionBtn} onPress={action.onPress}>
          <Text style={styles.actionText}>{action.label}</Text>
        </Touchable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 32 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  icon: { width: 30, height: 30 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionBtn: {
    marginTop: 20,
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionText: { color: '#000', fontWeight: '700', fontSize: 15 },
})
