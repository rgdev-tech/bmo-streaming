import { useCallback, useEffect, useRef, useState } from 'react'

type State<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Caché en memoria compartida entre montajes, para stale-while-revalidate.
 * Vive mientras vive el proceso de la app (no se persiste): su único fin es que
 * volver a una pantalla ya vista pinte AL INSTANTE con lo último que trajo, en
 * vez de mostrar el spinner de pantalla completa y refetchear desde cero cada
 * vez que se cambia de pestaña. La red igual se revalida por debajo.
 */
const cache = new Map<string, unknown>()

/** Limpia una entrada (o todo) del caché — útil tras una mutación que la invalida. */
export function invalidateAsync(key?: string) {
  if (key) cache.delete(key)
  else cache.clear()
}

/**
 * Precarga en segundo plano y deja el resultado en el caché, para que la primera
 * visita a esa pantalla ya pinte al instante (p. ej. precargar Películas/Series
 * apenas se ve el Inicio). No-op si ya hay algo cacheado bajo esa clave; los
 * fallos se tragan a propósito — es oportunista, no debe romper nada.
 */
export function prefetchAsync<T>(key: string, fn: () => Promise<T>) {
  if (cache.has(key)) return
  fn()
    .then((data) => cache.set(key, data))
    .catch(() => {})
}

/**
 * Hook de carga asíncrona con stale-while-revalidate opcional.
 *
 * Sin `cacheKey` se comporta como antes: loading → data|error, refetch manual.
 *
 * Con `cacheKey`, si ya hay un valor cacheado se entrega de inmediato
 * (loading:false) y se revalida en segundo plano SIN volver a loading — así el
 * cambio de pestaña es instantáneo y los datos frescos entran cuando llegan. El
 * spinner solo aparece la primera vez, cuando no hay nada que mostrar.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], cacheKey?: string) {
  const cached = cacheKey ? (cache.get(cacheKey) as T | undefined) : undefined

  const [state, setState] = useState<State<T>>(() => ({
    data: cached ?? null,
    loading: cached === undefined,
    error: null,
  }))
  // Incrementar fuerza un nuevo intento sin depender de que `deps` cambie
  const [tick, setTick] = useState(0)

  // `fn` cambia de identidad en cada render (suele ser una arrow inline); guardarla
  // en un ref evita meterla en las deps del effect y disparar refetches en loop.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    const hasStale = cacheKey !== undefined && cache.get(cacheKey) !== undefined
    // Con dato cacheado revalidamos en silencio: nada de loading:true (evita el
    // parpadeo del spinner sobre contenido ya visible).
    if (!hasStale) setState((s) => ({ ...s, loading: true, error: null }))

    fnRef.current()
      .then((data) => {
        if (cacheKey) cache.set(cacheKey, data)
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        // Si ya mostramos algo cacheado, un fallo de revalidación no debe borrar
        // la pantalla: se conserva lo stale y no se propaga el error.
        if (!cancelled && !hasStale)
          setState({ data: null, loading: false, error: String(e) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, cacheKey])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { ...state, refetch }
}
