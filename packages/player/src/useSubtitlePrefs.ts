import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSubtitleStyle,
  setSubtitleStyle,
  getSubtitleOffset,
  setSubtitleOffset,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from '@bmo/core/subtitleStyle'
import type { SrtCue } from '@bmo/core/srt'
import { isSpanish } from './format'
import type { SubMode, TrackLike } from './types'

export type SubtitlePrefs = {
  subStyle: SubtitleStyle
  subOffset: number
  subMode: SubMode
  chooseSubMode: (mode: SubMode) => void
  changeSubStyle: (patch: Partial<SubtitleStyle>) => void
  bumpOffset: (delta: number) => void
}

/**
 * Preferencias del subtítulo español: estilo (tamaño/color/fondo), sincronía
 * (offset persistido por título) y modo activo ('external' overlay / 'none' /
 * id de pista nativa). Auto-selección una sola vez, sin pisar la elección
 * manual: 1) el .srt externo si llegó; 2) una pista nativa en español. Ambas
 * deps porque cualquiera puede llegar primero (descarga vs onLoad de pistas).
 *
 * Compartido tal cual entre los dos motores (expo-video y VLC) y entre apps.
 */
export function useSubtitlePrefs(params: {
  offsetKey: string
  srtCues: SrtCue[]
  subtitleTracks: TrackLike[]
}): SubtitlePrefs {
  const { offsetKey, srtCues, subtitleTracks } = params

  const [subStyle, setSubStyleState] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  useEffect(() => { getSubtitleStyle().then(setSubStyleState) }, [])

  const [subOffset, setSubOffsetState] = useState(0)
  useEffect(() => { getSubtitleOffset(offsetKey).then(setSubOffsetState) }, [offsetKey])

  const [subMode, setSubMode] = useState<SubMode>('none')
  const subModeChosenByUser = useRef(false)

  useEffect(() => {
    if (subModeChosenByUser.current) return
    if (srtCues.length > 0) { setSubMode('external'); return }
    const es = subtitleTracks.find(isSpanish)
    if (es?.id) setSubMode(es.id)
  }, [srtCues, subtitleTracks])

  const chooseSubMode = useCallback((mode: SubMode) => {
    subModeChosenByUser.current = true
    setSubMode(mode)
  }, [])

  const changeSubStyle = useCallback((patch: Partial<SubtitleStyle>) => {
    setSubStyleState((prev) => {
      const next = { ...prev, ...patch }
      setSubtitleStyle(next)
      return next
    })
  }, [])

  const bumpOffset = useCallback((delta: number) => {
    setSubOffsetState((prev) => {
      // Tope: más de ±30s ya no es desincronización, es el subtítulo equivocado.
      const next = Math.round(Math.min(30, Math.max(-30, prev + delta)) * 10) / 10
      setSubtitleOffset(offsetKey, next)
      return next
    })
  }, [offsetKey])

  return { subStyle, subOffset, subMode, chooseSubMode, changeSubStyle, bumpOffset }
}
