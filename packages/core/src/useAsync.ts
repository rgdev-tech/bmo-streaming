import { useCallback, useEffect, useState } from 'react'

type State<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({
    data: null,
    loading: true,
    error: null,
  })
  // Incrementar fuerza un nuevo intento sin depender de que `deps` cambie
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fn()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: String(e) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { ...state, refetch }
}
