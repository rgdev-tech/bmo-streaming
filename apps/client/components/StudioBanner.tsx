import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { type StudioBrand } from '@/lib/studios'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

// Banner de marca en el buscador (Disney, HBO...) → abre el catálogo especial.
export function StudioBanner({ brand }: { brand: StudioBrand }) {
  const router = useRouter()

  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      style={styles.wrap}
      onPress={() => router.push(`/studio/${brand.key}` as never)}
    >
      <LinearGradient
        colors={brand.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.textCol}>
          <Text style={styles.kicker}>Catálogo especial</Text>
          <Text style={styles.name}>{brand.name}</Text>
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Ver</Text>
          <SymbolView name="chevron.right" tintColor="#fff" style={styles.ctaIcon} />
        </View>
      </LinearGradient>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  textCol: { flex: 1 },
  kicker: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  name: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  ctaText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ctaIcon: { width: 11, height: 11 },
})
