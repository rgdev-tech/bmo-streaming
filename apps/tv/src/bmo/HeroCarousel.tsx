import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import type { MediaItem } from '@bmo/core/tmdb'
import { Hero } from './Hero'
import { colors, safe } from './theme'

const ROTATE_MS = 9000
const FADE_OUT_MS = 400
const FADE_IN_MS = 600
export const HERO_ITEMS = 5

/**
 * Hero rotativo.
 *
 * El del teléfono es un FlatList paginado que sigue el dedo; acá no hay gesto,
 * así que la rotación es automática y la transición es un fundido en lugar de un
 * desplazamiento lateral. Un slide horizontal sin que nadie lo haya pedido se
 * lee como un glitch: el usuario no tocó nada y la pantalla se movió sola.
 *
 * Nueve segundos por título: suficiente para leer sinopsis de tres líneas sin
 * apuro, y no tanto como para que parezca colgado.
 */
export function HeroCarousel({ items }: { items: MediaItem[] }) {
  // Solo sirven los que tienen backdrop Y sinopsis: sin imagen no hay hero, y
  // sin texto el bloque inferior queda vacío y el fundido muestra un salto raro.
  const data = useMemo(
    () => items.filter((i) => i.backdrop_path && i.overview).slice(0, HERO_ITEMS),
    [items]
  )

  const [index, setIndex] = useState(0)
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (data.length < 2) return

    const timer = setInterval(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // Si la animación se interrumpió (desmontaje), no se toca el estado.
        if (!finished) return
        setIndex((i) => (i + 1) % data.length)
        Animated.timing(fade, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }).start()
      })
    }, ROTATE_MS)

    return () => clearInterval(timer)
  }, [data.length, fade])

  // Si cambia la lista (p. ej. al navegar de sección) el índice puede quedar
  // fuera de rango; se reinicia en vez de renderizar undefined.
  useEffect(() => {
    setIndex(0)
    fade.setValue(1)
  }, [data, fade])

  if (!data.length) return null
  const item = data[index] ?? data[0]

  return (
    <View>
      <Animated.View style={{ opacity: fade }}>
        <Hero item={item} />
      </Animated.View>

      {/* Indicador de posición. No es interactivo — no hay forma de saltar de
          slide sin foco — pero le dice al usuario que esto rota y cuánto falta,
          en vez de dejar que parezca que la pantalla cambia sola sin motivo. */}
      {data.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {data.map((d, i) => (
            <View key={d.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  dots: {
    position: 'absolute',
    right: safe.horizontal,
    bottom: 30,
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: { backgroundColor: colors.text },
})
