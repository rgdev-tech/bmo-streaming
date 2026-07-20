import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { usePathname, useRouter } from 'expo-router'
import { useAuth } from '@bmo/core/auth'
import { ProfileAvatar } from './ProfileAvatar'
import { colors, layout, safe } from './theme'

// `as const` para que las rutas queden como literales y las valide el sistema de
// rutas tipadas de expo-router (typedRoutes está activo en app.json). Con
// `string` suelto compila cualquier ruta inexistente.
const SECTIONS = [
  { label: 'Inicio', path: '/', icon: 'home' },
  { label: 'Series', path: '/series', icon: 'tv' },
  { label: 'Películas', path: '/peliculas', icon: 'film' },
  { label: 'Buscar', path: '/buscar', icon: 'search' },
  { label: 'Biblioteca', path: '/biblioteca', icon: 'bookmark' },
] as const

type Section = (typeof SECTIONS)[number]

/**
 * Rail de navegación lateral.
 *
 * Detalle de implementación que importa más de lo que parece: el rail ocupa un
 * ancho FIJO en el flujo del layout (railWidth) y todo lo que se despliega —
 * velo y etiquetas — se dibuja en capas absolutas que desbordan hacia la
 * derecha. Los dos motivos:
 *
 *  1. El motor de foco de TV navega por geometría del layout. Con el rail
 *     entero en `position: absolute` (primer intento), pulsar izquierda desde
 *     el catálogo no encontraba nada y el foco se quedaba atrapado en las filas.
 *     Los Pressable tienen que estar en el flujo para ser alcanzables.
 *  2. Si el ancho en flujo cambiara al desplegarse, todo el catálogo se
 *     reacomodaría cada vez que el usuario entra al menú.
 *
 * Se usan iconos de @expo/vector-icons y no SF Symbols como en el teléfono:
 * los SF Symbols son de Apple y no existen en Android TV.
 */
export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useAuth()

  // Cuenta de ítems enfocados en vez de un booleano: al moverse entre ítems el
  // blur del anterior llega DESPUÉS del focus del siguiente, así que un booleano
  // haría parpadear el rail cerrándose y abriéndose en cada paso.
  const [focusCount, setFocusCount] = useState(0)
  const expanded = focusCount > 0

  // El ítem activo recibe el foco durante el montaje (hasTVPreferredFocus), y
  // ese onFocus dispara un setState antes de que el componente termine de
  // montarse → "Can't perform a React state update on a component that hasn't
  // mounted yet". Ese primer cambio se difiere un tick para que caiga después
  // del commit. No se puede simplemente ignorar: el contador quedaría
  // desbalanceado y el rail se cerraría al moverse al segundo ítem.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])

  const bumpFocus = (focused: boolean) => {
    const apply = () => setFocusCount((n) => Math.max(0, n + (focused ? 1 : -1)))
    if (mounted.current) apply()
    else setTimeout(apply, 0)
  }

  const veil = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(veil, {
      toValue: expanded ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start()
  }, [expanded, veil])

  return (
    <View style={styles.rail}>
      {/* Velo que oscurece la franja del catálogo que las etiquetas van a tapar.
          Sin él las etiquetas caen sobre los pósters y no se leen. */}
      <Animated.View style={[styles.veil, { opacity: veil }]} pointerEvents="none" />

      {/* Degradado permanente: contraste para los iconos en reposo y funde el
          borde derecho del rail en vez de cortarlo a filo. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.92)', 'rgba(0,0,0,0.4)', 'transparent']}
        locations={[0, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.gradient}
        pointerEvents="none"
      />

      {/* El perfil va anclado arriba, no en el bloque de secciones: no es un
          destino más del catálogo, es "quién sos". Separarlo por posición dice
          eso mejor que una línea divisoria entre ítems pegados. */}
      {profile && (
        <View style={styles.profileSlot}>
          <RailItem
            avatar={profile.avatar}
            label={profile.name}
            active={false}
            expanded={expanded}
            onFocusChange={bumpFocus}
            // push y no replace: cambiar de perfil es una visita, y al volver
            // el usuario espera aterrizar donde estaba.
            onPress={() => router.push('/profiles')}
          />
        </View>
      )}

      <View style={styles.items}>
        {SECTIONS.map((s) => (
          <RailItem
            key={s.path}
            section={s}
            active={pathname === s.path}
            expanded={expanded}
            // El foco arranca en la sección activa. Sin esto cae en la primera
            // tarjeta del catálogo, el ScrollView la trae a la vista y el hero
            // desaparece antes de que el usuario toque nada.
            hasTVPreferredFocus={pathname === s.path}
            onFocusChange={bumpFocus}
            onPress={() => router.replace(s.path)}
          />
        ))}
      </View>
    </View>
  )
}

function RailItem({
  section,
  avatar,
  label,
  active,
  expanded,
  hasTVPreferredFocus,
  onFocusChange,
  onPress,
}: {
  /** Ítem de sección (icono + etiqueta del catálogo). */
  section?: Section
  /** Ítem de perfil: en vez de icono lleva el avatar del perfil activo. */
  avatar?: string | null
  label?: string
  active: boolean
  expanded: boolean
  hasTVPreferredFocus?: boolean
  onFocusChange: (focused: boolean) => void
  onPress: () => void
}) {
  const text = label ?? section?.label ?? ''

  return (
    <Pressable
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      // Ancho fijo: es la caja que ve el motor de foco. El contenido desborda.
      style={styles.hit}
    >
      {({ focused }) => (
        <View
          style={[
            styles.pill,
            { width: expanded ? layout.railExpandedWidth - 24 : layout.railWidth - 16 },
            focused && styles.pillFocused,
          ]}
        >
          {section ? (
            <Ionicons
              name={section.icon}
              size={21}
              color={focused ? '#000' : active ? colors.text : 'rgba(235,235,245,0.5)'}
            />
          ) : (
            // 21 px, el mismo alto que los iconos, para que el rail no se
            // desalinee entre el perfil y las secciones.
            <ProfileAvatar avatar={avatar} size={21} />
          )}
          {expanded && (
            <Text
              style={[
                styles.label,
                active && styles.labelActive,
                focused && styles.labelFocused,
              ]}
              numberOfLines={1}
            >
              {text}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  rail: {
    width: layout.railWidth,
    // El perfil queda arriba y las secciones centradas en lo que sobra: por eso
    // el bloque de ítems lleva flex:1 y no se centra el rail entero.
    justifyContent: 'flex-start',
    // Imprescindible: las etiquetas y el velo se dibujan fuera de estos límites.
    overflow: 'visible',
    zIndex: 10,
  },
  veil: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: layout.railExpandedWidth,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },
  gradient: { position: 'absolute', left: 0, top: 0, bottom: 0, width: layout.railWidth },
  profileSlot: { paddingLeft: 8, paddingTop: safe.top - 8 },
  // flex:1 + center: las secciones se reparten el alto que queda bajo el perfil
  // y quedan centradas ahí, no pegadas a él.
  items: { flex: 1, justifyContent: 'center', gap: 6, paddingLeft: 8 },
  hit: { width: layout.railWidth - 8, height: 42, justifyContent: 'center' },
  pill: {
    position: 'absolute',
    left: 0,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  pillFocused: { backgroundColor: 'rgba(255,255,255,0.95)' },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(235,235,245,0.5)',
  },
  labelActive: { color: colors.text, fontWeight: '700' },
  labelFocused: { color: '#000', fontWeight: '700' },
})
