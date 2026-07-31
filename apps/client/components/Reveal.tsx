import type { ReactNode } from 'react'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'

// Escalón entre filas. 55 ms se lee como una cascada: lo bastante separado para
// notarse, lo bastante corto para que la última no llegue tarde. Con diez filas
// la cascada entera dura poco más de medio segundo.
const STEP_MS = 55
// Tope del escalonado. Sin esto, una pantalla con muchas filas dejaría las
// últimas entrando cuando el usuario ya está haciendo scroll.
const MAX_STEPS = 8
const DURATION = 420

/**
 * Aparición escalonada de las filas de una pantalla de catálogo.
 *
 * Sin esto todas las filas aparecen de golpe en el mismo cuadro apenas
 * responde la red: el contenido "salta" a la pantalla. Entrando de a una, con
 * un desplazamiento corto hacia arriba, la carga se siente como algo que se
 * asienta en su lugar.
 *
 * Corre en el hilo de UI (Reanimated), así que la cascada no se entrecorta
 * aunque el JS esté ocupado montando el resto de las filas — que es justo lo
 * que pasa en ese momento.
 *
 * `entering` sólo dispara al montar: al hacer scroll o volver a la pantalla no
 * se repite, que sería mareador.
 */
export function Reveal({
  index = 0,
  children,
}: {
  index?: number
  children: ReactNode
}) {
  const delay = Math.min(index, MAX_STEPS) * STEP_MS
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(DURATION)}>
      {children}
    </Animated.View>
  )
}

/**
 * Cruce del esqueleto al contenido. El corte seco entre uno y otro es lo que
 * delata que hubo una espera; un fundido corto lo vuelve continuo.
 */
export function FadeSwap({ children }: { children: ReactNode }) {
  return <Animated.View entering={FadeIn.duration(260)}>{children}</Animated.View>
}
