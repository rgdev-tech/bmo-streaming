import { useCallback, useEffect, useRef } from 'react'
import { saveProgress } from '@bmo/core/library'
import type { MediaMeta } from './types'

const SAVE_EVERY_MS = 5000 // throttle de guardado (evita I/O por segundo)

export type ProgressSaver = {
  // El motor llama esto en cada tick de progreso: guarda (con throttle) y
  // recuerda la última posición para el guardado final al salir.
  report: (time: number, duration: number) => void
}

/**
 * Persiste el progreso de reproducción: throttled durante la marcha y un
 * guardado final al desmontar (aunque no haya pasado el intervalo). Las claves
 * de almacenamiento salen de `meta` y son las mismas en client y tv, así
 * "Seguir viendo" y el punto de retomar se comparten entre teléfono y TV.
 */
export function useProgressSaver(meta: MediaMeta): ProgressSaver {
  const progressRef = useRef({ time: 0, duration: 0 })
  const lastSave = useRef(0)
  // Espejo de meta siempre al día: el guardado final corre en el cleanup y no
  // debe capturar un meta viejo.
  const metaRef = useRef(meta)
  metaRef.current = meta

  const report = useCallback((time: number, duration: number) => {
    progressRef.current = { time, duration }
    const now = Date.now()
    if (duration > 0 && time > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...metaRef.current, position: time, duration })
    }
  }, [])

  // Guarda el progreso final al salir de la pantalla.
  useEffect(() => {
    return () => {
      const { time, duration } = progressRef.current
      if (duration > 0) saveProgress({ ...metaRef.current, position: time, duration })
    }
  }, [])

  return { report }
}
