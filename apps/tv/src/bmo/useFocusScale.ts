import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import { layout } from './theme'

/**
 * Escala animada para tarjetas enfocables. La comparten póster, backdrop y
 * ranking para que el realce del foco se sienta igual en toda la app: si cada
 * fila creciera distinto, recorrer la home daría la sensación de estar usando
 * tres apps pegadas.
 *
 * El primer foco puede llegar durante el montaje (hasTVPreferredFocus). Animar
 * ahí dispara "state update on a component that hasn't mounted yet", así que en
 * ese caso se fija el valor directo — no hay nada desde donde animar igual.
 */
export function useFocusScale(to: number = layout.focusScale) {
  const scale = useRef(new Animated.Value(1)).current
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
  }, [])

  const animate = (focused: boolean) => {
    const target = focused ? to : 1
    if (!mounted.current) {
      scale.setValue(target)
      return
    }
    Animated.spring(scale, {
      toValue: target,
      useNativeDriver: true,
      // Sin rebote: el foco tiene que asentarse rápido porque el usuario puede
      // estar recorriendo la fila a toda velocidad con la cruceta.
      speed: 30,
      bounciness: 0,
    }).start()
  }

  return {
    scale,
    onFocus: () => animate(true),
    onBlur: () => animate(false),
  }
}
