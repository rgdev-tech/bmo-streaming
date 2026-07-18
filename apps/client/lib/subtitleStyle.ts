import AsyncStorage from '@react-native-async-storage/async-storage'

export type SubtitleSize = 'small' | 'medium' | 'large'
export type SubtitleColor = 'white' | 'yellow' | 'cyan'
export type SubtitleBackground = 'none' | 'semi'

export type SubtitleStyle = {
  size: SubtitleSize
  color: SubtitleColor
  background: SubtitleBackground
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 'medium',
  color: 'white',
  background: 'none',
}

const KEY = 'bmo:subtitleStyle'

export async function getSubtitleStyle(): Promise<SubtitleStyle> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return DEFAULT_SUBTITLE_STYLE
    return { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SUBTITLE_STYLE
  }
}

export function setSubtitleStyle(style: SubtitleStyle): void {
  AsyncStorage.setItem(KEY, JSON.stringify(style)).catch(() => {})
}

// El subtítulo en español se renderiza como overlay de React (ver
// SubtitleOverlay en player.tsx), no vía VLCKit — así el estilo cambia al
// instante: las opciones de subtítulo de libvlc son de INSTANCIA, cambiarlas
// obligaba a recrear el reproductor entero (re-buffer de red incluido) cada
// vez que el usuario tocaba una opción. Estos valores son puro RN Text style.
export const SUBTITLE_FONT_SIZE: Record<SubtitleSize, number> = {
  small: 14,
  medium: 20,
  large: 28,
}

export const SUBTITLE_COLOR_CSS: Record<SubtitleColor, string> = {
  white: '#ffffff',
  yellow: '#ffe135',
  cyan: '#66ffff',
}
