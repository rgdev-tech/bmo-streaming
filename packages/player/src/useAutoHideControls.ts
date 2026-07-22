import { useCallback, useEffect, useRef, useState } from 'react'

const CONTROLS_TIMEOUT = 4000 // se ocultan solos tras este tiempo sin tocar nada
const SEEK_HINT_TIMEOUT = 900 // el badge de seek se desvanece tras esto

export type AutoHideControls = {
  controlsVisible: boolean
  reveal: () => void
  hide: () => void
  // Espejo para leer el valor dentro de handlers registrados una sola vez
  // (p.ej. el back handler), sin capturar un estado viejo.
  controlsVisibleRef: React.MutableRefObject<boolean>
}

/**
 * HUD que se revela con cualquier interacción y se oculta solo tras unos
 * segundos. Con el menú abierto no se auto-oculta (queda anclado); al cerrarlo,
 * reprograma el auto-hide. La lógica es idéntica en los dos motores y las dos
 * apps; el input que lo dispara (cruceta vs gestos) lo cablea cada shell.
 */
export function useAutoHideControls(opts: { menuOpen?: boolean; timeout?: number } = {}): AutoHideControls {
  const { menuOpen = false, timeout = CONTROLS_TIMEOUT } = opts
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const controlsVisibleRef = useRef(controlsVisible)
  controlsVisibleRef.current = controlsVisible

  const reveal = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), timeout)
  }, [timeout])

  const hide = useCallback(() => {
    clearTimeout(hideTimer.current)
    setControlsVisible(false)
  }, [])

  useEffect(() => {
    reveal()
    return () => clearTimeout(hideTimer.current)
  }, [reveal])

  // Con el menú abierto los controles no se esconden solos; al cerrarlo,
  // reprograma el auto-hide.
  useEffect(() => {
    if (menuOpen) {
      clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      reveal()
    }
  }, [menuOpen, reveal])

  return { controlsVisible, reveal, hide, controlsVisibleRef }
}

export type SeekHint = {
  // Salto acumulado a mostrar (±Ns); 0 = oculto.
  seekHint: number
  // Suma un salto al badge y reprograma su desvanecimiento.
  flashSeek: (delta: number) => void
}

/**
 * Badge transitorio de seek (±Ns) que aparece al saltar con la cruceta sin abrir
 * el HUD completo. Acumula saltos seguidos y se borra solo tras un ratito.
 */
export function useSeekHint(): SeekHint {
  const [seekHint, setSeekHint] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flashSeek = useCallback((delta: number) => {
    setSeekHint((prev) => prev + delta)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSeekHint(0), SEEK_HINT_TIMEOUT)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { seekHint, flashSeek }
}
