import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { posterUrl, titleOf, type MediaItem } from '@bmo/core/tmdb'
import { useFocusScale } from './useFocusScale'
import { colors, layout } from './theme'

/**
 * Tarjeta de póster enfocable con el control remoto.
 *
 * En TV no hay cursor ni tacto: el usuario mueve el foco con la cruceta, así que
 * el estado "enfocado" es la única señal de dónde está parado. Por eso se marca
 * con tres cosas a la vez (escala, borde y sombra) — en un panel grande y desde
 * lejos, una sola es fácil de perder de vista.
 */
export function PosterCard({
  item,
  onPress,
  onFocus,
  inGrid,
  size = 'normal',
}: {
  item: MediaItem
  onPress?: (item: MediaItem) => void
  /** Aviso al padre de que esta tarjeta tomó foco (para el scroll de la fila). */
  onFocus?: () => void
  /**
   * En cuadrícula la separación la pone el contenedor (gap), no la tarjeta.
   * Con el margen propio, la última columna arrastra un margen derecho que no
   * separa de nada y empuja el ancho total fuera del contenedor.
   */
  inGrid?: boolean
  /** 'large' = fila destacada (póster más grande). */
  size?: 'normal' | 'large'
}) {
  const { scale, onFocus: onScaleFocus, onBlur } = useFocusScale()
  const lg = size === 'large'
  const dims = lg
    ? { width: layout.posterWidthLg, height: layout.posterHeightLg }
    : { width: layout.posterWidth, height: layout.posterHeight }
  // Tamaño de imagen al render real: la tarjeta normal es 124 dp (~248 px), w342
  // alcanza y pesa mucho menos que w500. La grande (168 dp) sí usa w500.
  const uri = posterUrl(item.poster_path, 'w500')

  return (
    <Pressable
      onFocus={() => { onScaleFocus(); onFocus?.() }}
      onBlur={onBlur}
      onPress={() => onPress?.(item)}
      style={inGrid ? undefined : styles.pressable}
    >
      {({ focused }) => (
        <Animated.View style={[styles.card, { width: dims.width, transform: [{ scale }] }]}>
          <View style={[styles.posterWrap, focused && styles.posterWrapFocused]}>
            {uri ? (
              <Image
                source={uri}
                style={[styles.poster, dims]}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
                recyclingKey={String(item.id)}
              />
            ) : (
              <View style={[styles.poster, dims, styles.placeholder]}>
                <Text style={styles.placeholderText} numberOfLines={4}>
                  {titleOf(item)}
                </Text>
              </View>
            )}
          </View>

          {/* Sin rótulo debajo, a propósito: el póster ya trae el título impreso
              en el arte, así que la etiqueta era información repetida. Además
              colgaba fuera del alto de la tarjeta y el scroll-into-view del foco
              la dejaba cortada contra el borde inferior de la pantalla. */}
        </Animated.View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // El margen va acá y no en la tarjeta animada: si estuviera adentro, el scale
  // lo escalaría también y las tarjetas se empujarían entre sí al enfocarse.
  pressable: { marginRight: layout.cardGap },
  card: { width: layout.posterWidth },
  posterWrap: {
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    // Borde transparente siempre presente: si apareciera recién al enfocar, el
    // contenido se desplazaría 2px y la fila "temblaría".
    borderColor: 'transparent',
  },
  posterWrapFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  poster: {
    width: layout.posterWidth,
    height: layout.posterHeight,
    backgroundColor: colors.surface,
  },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 12 },
  placeholderText: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
  },
})
