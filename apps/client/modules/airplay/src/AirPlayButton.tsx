// Se importa desde 'expo' (no 'expo-modules-core'): en este workspace bun
// expo-modules-core está hoisteado y no resuelve desde el módulo local, pero
// 'expo' re-exporta ambos helpers. requireNativeView === requireNativeViewManager.
import { requireNativeView, requireNativeModule } from 'expo'
import type { ViewProps } from 'react-native'

// Vista nativa (AVRoutePickerView) y módulo (función isConnected), ambos
// registrados bajo Name("AirPlay") en AirPlayModule.swift.
const NativeAirPlayView = requireNativeView('AirPlay')

type NativeAirPlayModule = { isConnected: () => boolean }
// requireNativeModule lanza si el módulo nativo no está enlazado (p. ej. al
// correr en un binario viejo sin este módulo). Se degrada a un stub para no
// romper la pantalla — el botón simplemente no aparecerá útil.
let NativeAirPlayModule: NativeAirPlayModule
try {
  NativeAirPlayModule = requireNativeModule('AirPlay')
} catch {
  NativeAirPlayModule = { isConnected: () => false }
}

export type AirPlayButtonProps = ViewProps & {
  /** Tinte del ícono en reposo (hex, ej. "#FFFFFF"). */
  tint?: string
  /** Tinte cuando hay una TV conectada (hex). */
  activeTint?: string
  /** Se dispara al conectar/desconectar una salida AirPlay. */
  onConnectionChange?: (e: { nativeEvent: { connected: boolean } }) => void
}

/** ¿Hay una salida AirPlay activa ahora mismo? (síncrono, para el arranque). */
export function isAirPlayConnected(): boolean {
  try {
    return NativeAirPlayModule.isConnected()
  } catch {
    return false
  }
}

/** Botón de AirPlay nativo. Ocupa el tamaño que le des por `style`. */
export default function AirPlayButton(props: AirPlayButtonProps) {
  return <NativeAirPlayView {...props} />
}
