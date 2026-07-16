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

// Valores reales que le pasamos a libvlc (freetype) — separados del tipo de
// arriba porque la escala/color en pantalla no tiene por qué mapear 1:1 con
// los nombres que ve el usuario.
export const SUBTITLE_FONT_SCALE: Record<SubtitleSize, number> = {
  small: 0.75,
  medium: 1,
  large: 1.35,
}

// 0xRRGGBB
export const SUBTITLE_COLOR_HEX: Record<SubtitleColor, number> = {
  white: 0xffffff,
  yellow: 0xffe135,
  cyan: 0x66ffff,
}

export const SUBTITLE_BACKGROUND_OPACITY: Record<SubtitleBackground, number> = {
  none: 0,
  semi: 160, // 0-255
}
