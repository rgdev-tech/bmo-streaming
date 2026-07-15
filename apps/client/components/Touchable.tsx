import { useRef } from 'react'
import { Animated, Pressable, type GestureResponderEvent, type PressableProps } from 'react-native'
import * as Haptics from 'expo-haptics'

type Haptic = 'light' | 'medium' | 'heavy' | 'selection'

type TouchableProps = Omit<PressableProps, 'style'> & {
  scaleTo?: number
  haptic?: Haptic
  style?: any
  children?: React.ReactNode
}

function fireHaptic(kind: Haptic) {
  if (kind === 'selection') return Haptics.selectionAsync()
  const style = kind === 'medium'
    ? Haptics.ImpactFeedbackStyle.Medium
    : kind === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : Haptics.ImpactFeedbackStyle.Light
  return Haptics.impactAsync(style)
}

// Pressable animado: encoge + atenúa suavemente al tocar (feel Netflix/Apple TV).
// Drop-in de Pressable — mismo API + scaleTo/haptic opcionales.
export function Touchable({
  scaleTo = 0.96,
  haptic,
  style,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: TouchableProps) {
  const anim = useRef(new Animated.Value(0)).current // 0 = reposo, 1 = presionado

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] })
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] })

  // Mismo spring (sin rebote) en ambas direcciones — un timing distinto para
  // encoger y un spring con overshoot para volver se sentía descoordinado,
  // sobre todo cuando la animación de vuelta competía con la transición de
  // navegación (el rebote seguía "vivo" mientras la pantalla ya se deslizaba).
  function animateTo(toValue: number) {
    Animated.spring(anim, {
      toValue,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start()
  }

  function pressIn(e: GestureResponderEvent) {
    animateTo(1)
    onPressIn?.(e)
  }
  function pressOut(e: GestureResponderEvent) {
    animateTo(0)
    onPressOut?.(e)
  }
  function press(e: GestureResponderEvent) {
    if (haptic) fireHaptic(haptic)
    onPress?.(e)
  }

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={press} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  )
}
