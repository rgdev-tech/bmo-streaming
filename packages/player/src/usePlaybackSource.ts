import { useCallback, useEffect, useRef, useState } from 'react'
import {
  stream,
  getAudioLang,
  setAudioLang as persistAudioLang,
  type ResolveInfo,
  type AudioLang,
  type SourceOption,
} from '@bmo/core/stream'
import { getProgress } from '@bmo/core/library'

// Cuántas fuentes distintas probamos antes de rendirnos. Cada fallo de
// reproducción (incluido un códec que el dispositivo no decodifica, p.ej. HEVC
// en hardware sin soporte) excluye esa fuente y re-resuelve la siguiente.
const MAX_SOURCE_FALLBACKS = 4

export type PlaybackSourceParams = {
  type: 'movie' | 'tv'
  id: string | number
  season?: number
  episode?: number
  // Tope de fuentes a probar antes de mostrar el error. Default 4.
  maxFallbacks?: number
  // false = no resolver nada contra el API. Lo usa el teléfono cuando el título
  // está descargado (reproduce el archivo local) y mientras averigua si lo está:
  // sin esto se dispararía un resolve remoto que no se va a usar. Default true.
  enabled?: boolean
}

export type PlaybackSource = {
  info: ResolveInfo | null
  startAt: number
  error: string | null
  // Fuentes ya intentadas que fallaron al reproducir. Se pasan como `exclude` al
  // resolver, que las saltea. Cambiarlo dispara una nueva resolución.
  excluded: string[]
  // Idioma de audio: 'original' (subtitulado) | 'latino' (doblaje). Persistido.
  audioLang: AudioLang
  // Fuentes para el menú de calidad + índice elegido a mano (o null = automático).
  sources: SourceOption[]
  sourcesLoading: boolean
  pickedSource: number | null
  // Una fuente falló al reproducir → si queda margen la excluye y re-resuelve;
  // si no, deja el mensaje en `error`.
  onSourceFailed: (failedSource: string, message: string) => void
  changeAudioLang: (lang: AudioLang) => void
  pickSource: (i: number) => void
  // El motor reporta su posición actual para conservarla al cambiar de fuente.
  reportPosition: (t: number) => void
  setError: (message: string) => void
  // Reintento explícito del usuario. Limpia el error y vuelve a resolver
  // CONSERVANDO las exclusiones ya aprendidas. Sirve para fallos transitorios
  // (timeout, sin red); los fallos de fuente no llegan acá porque los absorbe
  // onSourceFailed antes de que se vea la pantalla de error.
  retry: () => void
}

/**
 * Orquestación de la pantalla de reproducción, headless y compartida entre
 * client (teléfono) y tv. Resuelve la mejor fuente, maneja el fallback por
 * `exclude` cuando una falla, la elección manual de calidad y el idioma de
 * audio. NO conoce el motor de video ni la UI: devuelve estado y acciones que
 * cada app cablea a su propio reproductor.
 *
 * Importante: al re-resolver NO se pone `info` en null. Desmontar el componente
 * de reproducción en cada re-resolución provocaba el crash "already released"
 * (carrera nativo↔JS). Manteniendo la fuente anterior hasta que llega la nueva,
 * el cambio fluye por la `uri` sin remontar el motor.
 */
export function usePlaybackSource(params: PlaybackSourceParams): PlaybackSource {
  const { type, season, episode } = params
  const id = params.id
  const isTv = type === 'tv'
  const maxFallbacks = params.maxFallbacks ?? MAX_SOURCE_FALLBACKS
  const enabled = params.enabled ?? true

  const [info, setInfo] = useState<ResolveInfo | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [error, setErrorState] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])

  // Default 'latino' — coincide con el default de getAudioLang(), así no dispara
  // un resolve de más con 'original' antes de leer la preferencia real.
  const [audioLang, setAudioLangState] = useState<AudioLang>('latino')
  useEffect(() => { getAudioLang().then(setAudioLangState) }, [])

  const [pickedSource, setPickedSource] = useState<number | null>(null)
  const [sources, setSources] = useState<SourceOption[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)

  // Última posición conocida, para conservarla al cambiar de fuente/calidad.
  const lastPositionRef = useRef(0)

  // ── Resolución de la fuente ────────────────────────────────────────────────
  // Corre en el primer render y cada vez que cambia `excluded` (una fuente
  // falló) o `audioLang`. La elección manual de calidad NO pasa por acá (es
  // imperativa, en pickSource).
  // `attempt` sube con cada retry manual: es lo único que fuerza a repetir el
  // effect cuando ningún otro input cambió.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function resolve() {
      const pos = await getProgress(Number(id), isTv ? 'tv' : 'movie', season, episode)
      if (cancelled) return
      setStartAt(pos)

      const res = isTv
        ? await stream.resolveTv(id, season ?? 1, episode ?? 1, audioLang, excluded)
        : await stream.resolveMovie(id, audioLang, excluded)
      if (cancelled) return
      setInfo(res)
    }
    resolve().catch((e) => !cancelled && setErrorState(String(e?.message ?? e)))
    return () => { cancelled = true }
  }, [id, isTv, season, episode, excluded, audioLang, enabled, attempt])

  // ── Lista de fuentes (para el menú de calidad) ─────────────────────────────
  // Se pide en segundo plano DESPUÉS de que hay stream: es info para un menú que
  // quizá nunca se abra, no debe competir con el arranque de la reproducción.
  const ready = !!info && enabled
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setSourcesLoading(true)
    stream.sources(isTv ? 'tv' : 'movie', id, season, episode, audioLang)
      .then((list) => { if (!cancelled) setSources(list) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSourcesLoading(false) })
    return () => { cancelled = true }
  }, [ready, isTv, id, season, episode, audioLang])

  // Una fuente falló al reproducir (URL muerta, señuelo que pasó el filtro, o un
  // códec que este dispositivo no decodifica). Si queda margen, la excluimos y
  // re-resolvemos; si no, mostramos el error. La granularidad del `exclude` es
  // por fuente: excluir 'realdebrid' cae a los scrapers HTTP, que suelen servir
  // H.264/HLS reproducibles donde el MKV/HEVC no lo era.
  const onSourceFailed = useCallback(
    (failedSource: string, message: string) => {
      if (!failedSource || excluded.includes(failedSource) || excluded.length >= maxFallbacks) {
        setErrorState(message)
        return
      }
      setExcluded((prev) => (prev.includes(failedSource) ? prev : [...prev, failedSource]))
    },
    [excluded, maxFallbacks]
  )

  // Cambia el idioma de audio: persiste, resetea calidad/exclusiones y deja que
  // el effect re-resuelva desde cero con la nueva preferencia.
  const changeAudioLang = useCallback((lang: AudioLang) => {
    setAudioLangState((prev) => {
      if (prev === lang) return prev
      persistAudioLang(lang)
      setPickedSource(null)
      setExcluded([])
      return lang
    })
  }, [])

  // Cambia de fuente por índice (menú de calidad): re-resuelve por la vía `pick`
  // y hace el swap desde la posición actual (no cuesta el progreso). No pone
  // info=null: el cambio entra por `uri` y el motor hace el swap seguro.
  const pickSource = useCallback(
    async (i: number) => {
      setPickedSource(i)
      try {
        const res = await stream.pickSource(isTv ? 'tv' : 'movie', id, i, season, episode, audioLang)
        setStartAt(lastPositionRef.current)
        setInfo(res)
      } catch {
        setErrorState('No se pudo abrir esa fuente')
      }
    },
    [isTv, id, season, episode, audioLang]
  )

  const reportPosition = useCallback((t: number) => { lastPositionRef.current = t }, [])
  const setError = useCallback((message: string) => setErrorState(message), [])

  const retry = useCallback(() => {
    setErrorState(null)
    setAttempt((n) => n + 1)
  }, [])

  return {
    info,
    startAt,
    error,
    excluded,
    audioLang,
    sources,
    sourcesLoading,
    pickedSource,
    onSourceFailed,
    changeAudioLang,
    pickSource,
    reportPosition,
    setError,
    retry,
  }
}
