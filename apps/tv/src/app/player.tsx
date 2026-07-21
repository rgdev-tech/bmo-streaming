import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useEventListener } from 'expo'
import {
  useVideoPlayer,
  VideoView,
  type AudioTrack,
  type SubtitleTrack,
} from 'expo-video'
// Player VLC (libVLC) para fuentes `file`/mkv: decodifica por software (HEVC,
// DTS, etc.) donde ExoPlayer depende del decoder del dispositivo. Mismo fork
// vendorizado que usa iOS. Se importa por ruta (no por nombre de paquete) para
// esquivar la resolución por symlink de Metro, igual que en apps/client.
import VideoVLC from '../../vendor/react-native-video-vlc/src/VideoVLC'
import type {
  VideoVLCRef,
  OnLoadData,
  OnProgressData,
  OnVideoErrorData,
} from '../../vendor/react-native-video-vlc/src'
import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import {
  getProgress,
  saveProgress,
  type Progress,
} from '@bmo/core/library'
import {
  stream,
  getAudioLang,
  setAudioLang as persistAudioLang,
  type ResolveInfo,
  type AudioLang,
  type Subtitle,
  type SourceOption,
} from '@bmo/core/stream'
import { parseSrt, findActiveCue, decodeSrtBytes, type SrtCue } from '@bmo/core/srt'
import {
  getSubtitleStyle,
  setSubtitleStyle,
  getSubtitleOffset,
  setSubtitleOffset,
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONT_SIZE,
  SUBTITLE_COLOR_CSS,
  type SubtitleStyle,
} from '@bmo/core/subtitleStyle'
import { FocusButton } from '@/bmo/FocusButton'
import { colors, heroTitle, safe } from '@/bmo/theme'

const SAVE_EVERY_MS = 5000
const SEEK_STEP = 10 // segundos por pulsación de la cruceta
const CONTROLS_TIMEOUT = 4000 // se ocultan solos tras este tiempo sin tocar nada
// Cuántas fuentes distintas probamos antes de rendirnos. Cada fallo de
// reproducción (incluido un códec que el dispositivo no decodifica, p.ej. HEVC
// en hardware sin soporte) excluye esa fuente y re-resuelve la siguiente.
const MAX_SOURCE_FALLBACKS = 4

// Pestañas del menú de opciones (mismas que el reproductor del teléfono).
// Vista del menú de opciones: 'main' = las dos columnas simultáneas
// (Subtítulos + Audio, estilo HBO); el resto son los "paneles" de extras que se
// abren desde los iconos de la barra superior.
type MenuTabKey = 'main' | 'style' | 'quality' | 'screen'

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// ¿Esta pista (audio o subtítulo) es española? Se mira el código de idioma
// (ISO 639) y, como respaldo, la etiqueta legible — muchos MKV no titulan las
// pistas pero sí las etiquetan por idioma.
function isSpanish(t: { language?: string; label?: string }): boolean {
  const lang = (t.language ?? '').toLowerCase()
  if (lang.startsWith('es') || lang.startsWith('spa')) return true
  return /\b(?:spa|esp|spanish|español|castellano|latino)\b/i.test(t.label ?? '')
}

// Etiqueta legible de una fuente: "4K · HDR · HEVC · 12.4 GB". El nombre de
// archivo crudo va debajo como línea secundaria.
function describeSource(s: SourceOption): string {
  const parts: string[] = []
  parts.push(
    s.resolution === 2160 ? '4K'
    : s.resolution ? `${s.resolution}p`
    : 'Calidad desconocida'
  )
  if (s.hdr && s.hdr !== 'none') parts.push(s.hdr === 'dv' ? 'Dolby Vision' : 'HDR')
  if (s.codec) parts.push(s.codec === 'hevc' ? 'HEVC' : s.codec === 'h264' ? 'H.264' : s.codec.toUpperCase())
  if (s.langs.includes('latino')) parts.push('Latino')
  if (s.sizeGB != null) parts.push(s.sizeGB >= 1 ? `${s.sizeGB.toFixed(1)} GB` : `${Math.round(s.sizeGB * 1024)} MB`)
  return parts.join('  ·  ')
}

// Baja el subtítulo español y lo parsea EN MEMORIA (sin escribir a disco: en TV
// no tenemos expo-file-system y solo necesitamos las cues para el overlay JS).
// Se lee como bytes crudos y se decodifica con decodeSrtBytes, igual que el
// teléfono, para no romper acentos cuando el .srt viene en latin1.
async function fetchSpanishSubs(subs: Subtitle[]): Promise<SrtCue[]> {
  const esSubs = subs.filter((s) => s.lang === 'es')
  for (const s of esSubs) {
    for (const url of [s.url, ...(s.altUrls ?? [])]) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const ct = res.headers.get('content-type') ?? ''
        // Un .srt real nunca es text/html; una página de bloqueo de Cloudflare sí.
        if (/text\/html/i.test(ct)) continue
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const cues = parseSrt(decodeSrtBytes(binary))
        if (cues.length) return cues
      } catch {
        // siguiente url
      }
    }
  }
  return []
}

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string
    id: string
    title?: string
    poster?: string
    backdrop?: string
    season?: string
    episode?: string
  }>()

  const isTv = params.type === 'tv'
  const id = params.id
  const seasonN = params.season ? Number(params.season) : undefined
  const episodeN = params.episode ? Number(params.episode) : undefined

  const [info, setInfo] = useState<ResolveInfo | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Fuentes ya intentadas que fallaron al reproducir. Se pasan como `exclude` al
  // resolver, que las saltea y devuelve la siguiente. Cambiarlo dispara una
  // nueva resolución (ver el effect de abajo) y remonta el <Playback>.
  const [excluded, setExcluded] = useState<string[]>([])

  // Idioma de audio: 'original' (subtitulado) | 'latino' (doblaje). Persistido.
  // Default 'latino' — coincide con el default de getAudioLang(), así no dispara
  // un resolve de más con 'original' antes de leer la preferencia real.
  const [audioLang, setAudioLangState] = useState<AudioLang>('latino')
  useEffect(() => { getAudioLang().then(setAudioLangState) }, [])

  // Selector de calidad: fuente elegida a mano (índice) — cambia la resolución
  // por la vía `pick`, sin pasar por el resolve automático.
  const [pickedSource, setPickedSource] = useState<number | null>(null)
  const [sources, setSources] = useState<SourceOption[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)

  // Subtítulo en español descargado + parseado (overlay JS con estilo propio).
  const [srtCues, setSrtCues] = useState<SrtCue[]>([])

  // Última posición conocida, para conservarla al cambiar de fuente/calidad.
  const lastPositionRef = useRef(0)

  // Datos para persistir progreso, idénticos a los que guarda apps/client, para
  // que "Seguir viendo" y el punto de retomar sean compartidos entre teléfono
  // y TV — las claves de almacenamiento son las mismas.
  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    // Guardamos SOLO el título base, sin el sufijo "· T_:E_": la temporada y el
    // episodio ya van en season/episode. Si lo guardáramos con sufijo, cada
    // pantalla que lo re-muestra le agrega otro y se acumula ("· T9:E2 · T9:E2…").
    // El regex saca uno o más sufijos al final (limpia también títulos ya viciados).
    title: (params.title ?? '').replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, ''),
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  // ── Resolución de la fuente ────────────────────────────────────────────────
  // Corre en el primer render y cada vez que cambia `excluded` (una fuente
  // falló) o `audioLang`. Vuelve al loader mientras re-resuelve, así el
  // <Playback> se desmonta y vuelve a montar con la URI nueva. La elección
  // manual de calidad NO pasa por acá (es imperativa, en pickSource).
  useEffect(() => {
    let cancelled = false
    // NO ponemos info=null acá: eso desmontaba <Playback> (y su VideoPlayer) en
    // cada re-resolución, y ese remount rápido es lo que provocaba el crash
    // "Cannot use shared object that was already released" (carrera nativo↔JS: la
    // mutación Fabric de setear el prop `player` llegaba después de que el JS ya
    // había liberado ese player en el unmount). Manteniendo la fuente anterior
    // hasta que llega la nueva, <Playback> NO se remonta: el cambio de `uri`
    // fluye por useVideoPlayer, que libera el player viejo en un effect (después
    // de commitear el nuevo al VideoView), sin carrera. Solo el primer arranque
    // muestra el loader, porque `info` ya nace en null.

    async function resolve() {
      const pos = await getProgress(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN)
      if (cancelled) return
      setStartAt(pos)

      const res = isTv
        ? await stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1, audioLang, excluded)
        : await stream.resolveMovie(id, audioLang, excluded)
      if (cancelled) return
      setInfo(res)
    }

    resolve().catch((e) => !cancelled && setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [id, isTv, seasonN, episodeN, excluded, audioLang])

  // ── Lista de fuentes (para el menú de calidad) ─────────────────────────────
  // Se pide en segundo plano DESPUÉS de que hay stream: es info para un menú que
  // quizá nunca se abra, no debe competir con el arranque de la reproducción.
  const ready = !!info
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setSourcesLoading(true)
    stream.sources(isTv ? 'tv' : 'movie', id, seasonN, episodeN, audioLang)
      .then((list) => { if (!cancelled) setSources(list) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSourcesLoading(false) })
    return () => { cancelled = true }
  }, [ready, isTv, id, seasonN, episodeN, audioLang])

  // ── Subtítulo español (overlay JS) ─────────────────────────────────────────
  // Se baja en paralelo, sin bloquear el arranque; el overlay lo recoge apenas
  // llega. Se re-baja por fuente (cada info nuevo trae sus propios subtítulos).
  useEffect(() => {
    if (!info) { setSrtCues([]); return }
    if (info.type !== 'file') { setSrtCues([]); return }
    let cancelled = false
    fetchSpanishSubs(info.subtitles ?? [])
      .then((cues) => { if (!cancelled) setSrtCues(cues) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [info])

  // Una fuente falló al reproducir (URL muerta, señuelo que pasó el filtro, o un
  // códec que este dispositivo no decodifica). Si queda margen, la excluimos y
  // re-resolvemos; si no, mostramos el error. La granularidad del `exclude` es
  // por fuente (no por archivo): excluir 'realdebrid' cae a los scrapers HTTP,
  // que suelen servir H.264/HLS reproducibles donde el MKV/HEVC no lo era.
  const handleSourceFailed = useCallback(
    (failedSource: string, message: string) => {
      if (
        !failedSource ||
        excluded.includes(failedSource) ||
        excluded.length >= MAX_SOURCE_FALLBACKS
      ) {
        setError(message)
        return
      }
      setExcluded((prev) => (prev.includes(failedSource) ? prev : [...prev, failedSource]))
    },
    [excluded]
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
  // y remonta el player desde la posición actual (no cuesta el progreso).
  const pickSource = useCallback(
    async (i: number) => {
      setPickedSource(i)
      // Igual que en el re-resolve: no desmontamos el player (no info=null). El
      // cambio de fuente entra por `uri` y useVideoPlayer hace el swap seguro.
      try {
        const res = await stream.pickSource(isTv ? 'tv' : 'movie', id, i, seasonN, episodeN, audioLang)
        setStartAt(lastPositionRef.current)
        setInfo(res)
      } catch {
        setError('No se pudo abrir esa fuente')
      }
    },
    [isTv, id, seasonN, episodeN, audioLang]
  )

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>No pude reproducir</Text>
        <Text style={styles.errorHint} numberOfLines={3}>
          {error}
        </Text>
        <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
      </View>
    )
  }

  if (!info) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.loadingText}>
          {excluded.length ? 'Probando otra fuente…' : 'Buscando la mejor fuente…'}
        </Text>
      </View>
    )
  }

  // Motor de reproducción según el tipo de fuente:
  //  - 'file' (real-debrid/scrapers directos, mkv/HEVC/etc.) → VLC (libVLC),
  //    que decodifica por software y reproduce lo que ExoPlayer no puede.
  //  - 'hls' (master proxeado por nuestro API) → expo-video/ExoPlayer, que
  //    maneja HLS nativo mejor. Mismos props para ambos (swap limpio).
  const Engine = info.type === 'file' ? VlcPlayback : Playback

  return (
    <Engine
      // Sin `key` de remount a propósito: los cambios de fuente (fallback por
      // `excluded` o elección manual) fluyen por la prop `info` → `uri`, y el
      // motor hace el swap de forma segura. Remontar acá era lo que causaba la
      // carrera "already released" (ver el resolve effect).
      info={info}
      excluded={excluded}
      audioLang={audioLang}
      startAt={startAt}
      meta={meta}
      title={params.title ?? ''}
      srtCues={srtCues}
      sources={sources}
      sourcesLoading={sourcesLoading}
      activeSourceIndex={pickedSource}
      offsetKey={`${params.type}-${id}-${seasonN ?? 0}-${episodeN ?? 0}`}
      onExit={() => router.back()}
      onSourceFailed={handleSourceFailed}
      onChangeAudioLang={changeAudioLang}
      onPickSource={pickSource}
      onPosition={(t) => { lastPositionRef.current = t }}
    />
  )
}

// Props comunes a los dos motores de reproducción (expo-video y VLC). El
// PlayerScreen elige el componente por info.type y le pasa exactamente esto.
type PlaybackProps = {
  info: ResolveInfo
  excluded: string[]
  audioLang: AudioLang
  startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  srtCues: SrtCue[]
  sources: SourceOption[]
  sourcesLoading: boolean
  activeSourceIndex: number | null
  offsetKey: string
  onExit: () => void
  onSourceFailed: (failedSource: string, message: string) => void
  onChangeAudioLang: (lang: AudioLang) => void
  onPickSource: (i: number) => void
  onPosition: (t: number) => void
}

/**
 * Reproducción propiamente dicha, en su propio componente para montarse recién
 * cuando la fuente ya está resuelta: useVideoPlayer necesita la URI en el
 * primer render, no admite recibirla después.
 *
 * Controles de transporte por cruceta, no táctiles: OK alterna play/pausa,
 * izquierda/derecha saltan ±10 s, ARRIBA abre el menú de opciones, y cualquier
 * tecla revela los controles, que se ocultan solos tras unos segundos.
 *
 * Los controles de transporte son un HUD visual, no botones enfocables: en un
 * reproductor de TV el control es el mando, no el foco. El MENÚ, en cambio, sí
 * es enfocable — mientras está abierto el motor de foco nativo maneja la
 * cruceta y useTVEventHandler se hace a un lado (ver el guard de menuOpenRef).
 */
function Playback({
  info,
  excluded,
  audioLang,
  startAt,
  meta,
  title,
  srtCues,
  sources,
  sourcesLoading,
  activeSourceIndex,
  offsetKey,
  onExit,
  onSourceFailed,
  onChangeAudioLang,
  onPickSource,
  onPosition,
}: PlaybackProps) {
  // Precaución: sacamos este componente del React Compiler. expo-video expone el
  // player como un SharedObject nativo que mutamos en directo (bufferOptions,
  // currentTime, play/pause, subtitleTrack, audioTrack…), y el compiler puede
  // reordenar/memoizar esas mutaciones de formas sutiles (ver expo/expo#36301).
  // No era la causa del crash "already released" —ese era el remount rápido del
  // player, ya resuelto arriba (sin `key`, swap por `uri`)— pero mantener el
  // player fuera del compiler es lo prudente para un componente que lo muta tanto.
  'use no memo'

  // Para HLS se reproduce el master proxeado por nuestro API (variantes +
  // segmentos + subtítulos); para fuentes 'file' se prueba la URL directa, que
  // en Android (ExoPlayer) soporta mkv nativo. Si el archivo no reproduce (incl.
  // un códec no soportado), cae a onSourceFailed, que excluye la fuente y prueba
  // la siguiente. El master HLS re-resuelve en el servidor, así que le pasamos
  // el mismo `exclude` para que elija la misma fuente ya validada acá.
  const isTv = meta.media_type === 'tv'
  const uri =
    info.type === 'hls'
      ? isTv
        ? stream.masterTv(meta.id, meta.season ?? 1, meta.episode ?? 1, audioLang, excluded)
        : stream.masterMovie(meta.id, audioLang, excluded)
      : info.streamUrl

  const player = useVideoPlayer(
    {
      uri,
      headers: info.referer ? { Referer: info.referer } : undefined,
      contentType: info.type === 'hls' ? 'hls' : 'auto',
    },
    (p) => {
      p.timeUpdateEventInterval = 0.5
      // Arranque más rápido en Android (Media3/ExoPlayer): en vez de esperar a
      // llenar un buffer grande antes de la primera imagen, empezamos con ~2s
      // (minBufferForPlayback) y priorizamos tiempo sobre tamaño para que los
      // archivos pesados (4K/HEVC) no queden esperando a acumular bytes. El
      // buffer hacia adelante en marcha sigue siendo holgado (30s) para no
      // recargar. Ver docs v56 → VideoPlayer.bufferOptions.
      p.bufferOptions = {
        preferredForwardBufferDuration: 30,
        minBufferForPlayback: 2,
        prioritizeTimeOverSizeThreshold: true,
      }
    }
  )

  const [playing, setPlaying] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [buffering, setBuffering] = useState(true)

  // Menú de opciones (Audio / Subtítulos / Estilo / Calidad). null = cerrado.
  const [menuTab, setMenuTab] = useState<MenuTabKey | null>(null)
  const menuOpenRef = useRef(false)
  menuOpenRef.current = menuTab !== null
  // Espejo del valor actual para leerlo dentro del handler de Atrás (que se
  // registra una sola vez y no debe capturar un menuTab viejo).
  const menuTabRef = useRef(menuTab)
  menuTabRef.current = menuTab

  // Pistas nativas expuestas por expo-video (ExoPlayer): audio y subtítulos
  // embebidos / del HLS. La selección de audio va directo al player; la de
  // subtítulos pasa por subMode (abajo) para poder convivir con el overlay JS.
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [currentAudioId, setCurrentAudioId] = useState<string | undefined>(undefined)

  // Subtítulo: 'external' = el .srt español que bajamos y dibujamos nosotros
  // (estilo/sincronía ajustables); 'none' = apagado; string = id de una pista
  // nativa (la pinta ExoPlayer). Si hay español disponible arranca ahí.
  const [subMode, setSubMode] = useState<'external' | 'none' | string>('none')
  const subModeChosenByUser = useRef(false)

  // Estilo y sincronía del overlay español (solo afecta al modo 'external').
  const [subStyle, setSubStyleState] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  useEffect(() => { getSubtitleStyle().then(setSubStyleState) }, [])
  const [subOffset, setSubOffsetState] = useState(0)
  useEffect(() => { getSubtitleOffset(offsetKey).then(setSubOffsetState) }, [offsetKey])

  const progressRef = useRef({ time: 0, duration: 0 })
  const lastSave = useRef(0)
  const started = useRef(false)
  // Un solo reporte de fallo por montaje: el player puede emitir varios eventos
  // 'error' seguidos, pero la fuente se excluye una sola vez.
  const reportedFail = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Antes, el remount por fuente reseteaba estos flags solo. Ahora que <Playback>
  // NO se remonta (para evitar la carrera "already released"), los reseteamos a
  // mano cuando cambia la `uri`: `started` para volver a buscar el punto de
  // retomar en el player nuevo, y `reportedFail` para que la fuente nueva pueda
  // reportar su propio fallo una sola vez.
  useEffect(() => {
    started.current = false
    reportedFail.current = false
  }, [uri])

  // "Llenar pantalla" (recorta bordes) vs "Ajustar" (ve el frame completo).
  const [filled, setFilled] = useState(false)

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT)
  }, [])

  useEffect(() => {
    revealControls()
    return () => clearTimeout(hideTimer.current)
  }, [revealControls])

  // Con el menú abierto los controles no se esconden solos (el menú se ancla a
  // esta capa) y quedan a la vista; al cerrarlo, reprograma el auto-hide.
  useEffect(() => {
    if (menuTab) {
      clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      revealControls()
    }
  }, [menuTab, revealControls])

  // Atrás cierra el menú si está abierto (consume el evento); si no, deja que
  // el back del sistema saque del reproductor.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Con un panel de extras abierto (Estilo/Calidad/Pantalla), Atrás vuelve a
      // las dos columnas; en la vista principal, Atrás cierra el menú entero.
      const t = menuTabRef.current
      if (t && t !== 'main') { setMenuTab('main'); return true }
      if (t === 'main') { setMenuTab(null); return true }
      return false
    })
    return () => sub.remove()
  }, [])

  useEventListener(player, 'statusChange', ({ status, error: err }) => {
    if (status === 'readyToPlay') {
      setBuffering(false)
      if (!started.current) {
        started.current = true
        // El retomar arranca unos segundos antes de donde se dejó, para dar
        // contexto; por debajo de 5 s no vale la pena y arranca del principio.
        if (startAt > 5) player.currentTime = Math.max(0, startAt - 3)
        player.play()
      }
      // Puede que las pistas ya estén disponibles al quedar listo (además de
      // los eventos *TracksChange, que a veces llegan antes del readyToPlay).
      setAudioTracks(player.availableAudioTracks ?? [])
      setSubtitleTracks(player.availableSubtitleTracks ?? [])
      setCurrentAudioId(player.audioTrack?.id)
    } else if (status === 'loading') {
      setBuffering(true)
    } else if (status === 'error') {
      if (!reportedFail.current) {
        reportedFail.current = true
        onSourceFailed(info.source, err?.message ?? 'Error de reproducción')
      }
    }
  })

  useEventListener(player, 'availableAudioTracksChange', ({ availableAudioTracks }) =>
    setAudioTracks(availableAudioTracks ?? [])
  )
  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) =>
    setSubtitleTracks(availableSubtitleTracks ?? [])
  )
  useEventListener(player, 'audioTrackChange', ({ audioTrack }) =>
    setCurrentAudioId(audioTrack?.id)
  )

  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying))

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const dur = player.duration
    progressRef.current = { time: currentTime, duration: dur }
    setPosition(currentTime)
    onPosition(currentTime)
    if (dur > 0) setDuration(dur)

    const now = Date.now()
    if (dur > 0 && currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...meta, position: currentTime, duration: dur })
    }
  })

  // Guarda el progreso final al salir, aunque no haya pasado el intervalo.
  useEffect(() => {
    return () => {
      const { time, duration: d } = progressRef.current
      if (d > 0) saveProgress({ ...meta, position: time, duration: d })
    }
    // meta es estable dentro de esta pantalla; deps vacías a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Elección automática de subtítulo (una vez, sin pisar una elección manual):
  // 1) el .srt externo si llegó; 2) una pista nativa en español. Ambas deps
  // porque cualquiera puede llegar primero (descarga vs onLoad de pistas).
  useEffect(() => {
    if (subModeChosenByUser.current) return
    if (srtCues.length > 0) { setSubMode('external'); return }
    const es = subtitleTracks.find(isSpanish)
    if (es?.id) setSubMode(es.id)
  }, [srtCues, subtitleTracks])

  // Aplica el modo de subtítulo al player: para 'external'/'none' no hay pista
  // nativa (la externa la dibujamos nosotros); para un id, se busca la pista.
  useEffect(() => {
    if (subMode === 'external' || subMode === 'none') {
      player.subtitleTrack = null
      return
    }
    const t = subtitleTracks.find((st) => st.id === subMode)
    player.subtitleTrack = t ?? null
  }, [subMode, subtitleTracks, player])

  const chooseSubMode = useCallback((mode: 'external' | 'none' | string) => {
    subModeChosenByUser.current = true
    setSubMode(mode)
  }, [])

  const selectAudioTrack = useCallback((t: AudioTrack) => {
    player.audioTrack = t
    setCurrentAudioId(t.id)
  }, [player])

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

  const togglePlay = useCallback(() => {
    if (player.playing) player.pause()
    else player.play()
  }, [player])

  const seekBy = useCallback(
    (delta: number) => {
      const dur = player.duration || Infinity
      const next = Math.max(0, Math.min(dur, player.currentTime + delta))
      player.currentTime = next
      setPosition(next)
    },
    [player]
  )

  // Los controles del player son FOCUSABLES (Pressable), navegados por el motor
  // de foco nativo de Android TV — el mismo que usa el resto de la app y que sí
  // responde a la cruceta. `useTVEventHandler` NO sirve acá para direccionales:
  // cuando el player no tiene nada enfocable, el sistema de foco consume/pierde
  // los eventos de cruceta antes de que lleguen al handler (por eso "arriba" no
  // abría nada). Solo escuchamos la tecla dedicada de PLAY/PAUSE del mando
  // físico, que no la maneja el foco, como atajo extra.
  useTVEventHandler((evt) => {
    if (evt?.eventType === 'playPause') {
      revealControls()
      togglePlay()
    }
  })

  const pct = duration > 0 ? Math.min(1, position / duration) : 0
  const remaining = Math.max(0, duration - position)
  const activeCue = subMode === 'external' ? findActiveCue(srtCues, position - subOffset) : null
  // El título viene con el sufijo "· T_:E_" desde el detalle; lo separamos para
  // mostrar título y episodio en dos líneas (como la referencia).
  const baseTitle = title.replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, '')
  const episodeLabel = isTv ? `T${meta.season ?? 1} · E${meta.episode ?? 1}` : undefined

  return (
    <View style={styles.playerRoot}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit={filled ? 'cover' : 'contain'}
        nativeControls={false}
      />

      {/* Overlay del subtítulo español (modo 'external'): lo dibujamos nosotros
          para poder cambiar tamaño/color/fondo/sincronía al instante. */}
      {activeCue && (
        <View style={styles.subtitleOverlay} pointerEvents="none">
          <Text
            style={[
              styles.subtitleText,
              {
                fontSize: SUBTITLE_FONT_SIZE[subStyle.size],
                color: SUBTITLE_COLOR_CSS[subStyle.color],
                backgroundColor: subStyle.background === 'semi' ? 'rgba(0,0,0,0.6)' : 'transparent',
              },
            ]}
          >
            {activeCue.text}
          </Text>
        </View>
      )}

      {buffering && (
        <View style={styles.bufferBadge} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}

      {/* Controles: barra inferior con una sola fila enfocable (transport al
          centro; tuerca de ajustes a la derecha, que abre el menú de opciones
          —Audio/Subtítulos/Estilo/Calidad/Pantalla—). Todo en
          horizontal → la cruceta navega izquierda/derecha, sin saltos verticales
          (que el foco de Android TV no resuelve bien). Se atenúan solos pero
          siguen montados: cualquier movimiento los revela (onFocus). No se
          muestran con el menú abierto. */}
      {!menuTab && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {controlsVisible && (
            <>
              <LinearGradient
                colors={['rgba(0,0,0,0.6)', 'transparent']}
                style={styles.scrimTop}
                pointerEvents="none"
              />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.92)']}
                style={styles.scrimBottom}
                pointerEvents="none"
              />
            </>
          )}

          <View
            style={[styles.controls, { opacity: controlsVisible ? 1 : 0 }]}
            pointerEvents="box-none"
          >
            {/* Volver, arriba a la izquierda */}
            <View style={styles.topRow}>
              <IconBtn
                onFocus={revealControls}
                onPress={onExit}
                render={(f) => <Ionicons name="chevron-back" size={30} color={f ? '#000' : '#fff'} />}
              />
            </View>

            {/* Bloque inferior: título + tiempo, scrubber, fila de controles */}
            <View style={styles.bottomBlock}>
              <View style={styles.metaRow}>
                <View style={styles.metaText}>
                  <Text style={styles.title} numberOfLines={1}>{baseTitle}</Text>
                  {!!episodeLabel && (
                    <Text style={styles.episode} numberOfLines={1}>{episodeLabel}</Text>
                  )}
                </View>
                <Text style={styles.remaining}>-{fmt(remaining)}</Text>
              </View>

              <View style={styles.timeline}>
                <View style={[styles.timelineFill, { width: `${pct * 100}%` }]} />
                <View style={[styles.knob, { left: `${pct * 100}%` }]} />
              </View>

              <View style={styles.controlRow}>
                <View style={styles.sideGroup} />

                <View style={styles.centerGroup}>
                  <IconBtn
                    onFocus={revealControls}
                    onPress={() => { revealControls(); seekBy(-SEEK_STEP) }}
                    render={(f) => <MaterialIcons name="replay-10" size={34} color={f ? '#000' : '#fff'} />}
                  />
                  <IconBtn
                    big
                    hasTVPreferredFocus
                    onFocus={revealControls}
                    onPress={() => { revealControls(); togglePlay() }}
                    render={(f) => <Ionicons name={playing ? 'pause' : 'play'} size={40} color={f ? '#000' : '#fff'} />}
                  />
                  <IconBtn
                    onFocus={revealControls}
                    onPress={() => { revealControls(); seekBy(SEEK_STEP) }}
                    render={(f) => <MaterialIcons name="forward-10" size={34} color={f ? '#000' : '#fff'} />}
                  />
                </View>

                <View style={[styles.sideGroup, styles.sideRight]}>
                  <IconBtn
                    onFocus={revealControls}
                    onPress={() => setMenuTab('main')}
                    render={(f) => <Ionicons name="settings-outline" size={30} color={f ? '#000' : '#fff'} />}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {menuTab && (
        <OptionsMenu
          tab={menuTab}
          onTab={setMenuTab}
          hasStyleTab={srtCues.length > 0}
          audioLang={audioLang}
          hasLatinoAlternative={info.hasLatinoAlternative}
          audioTracks={audioTracks}
          currentAudioId={currentAudioId}
          subtitleTracks={subtitleTracks}
          hasExternalSubs={srtCues.length > 0}
          subMode={subMode}
          subStyle={subStyle}
          subOffset={subOffset}
          sources={sources}
          sourcesLoading={sourcesLoading}
          activeSourceIndex={activeSourceIndex}
          filled={filled}
          onSetFilled={setFilled}
          onChangeAudioLang={onChangeAudioLang}
          onSelectAudioTrack={selectAudioTrack}
          onChooseSubMode={chooseSubMode}
          onChangeSubStyle={changeSubStyle}
          onBumpOffset={bumpOffset}
          onPickSource={(i) => { setMenuTab(null); onPickSource(i) }}
          onClose={() => setMenuTab(null)}
        />
      )}
    </View>
  )
}

/**
 * Reproducción con VLC (libVLC) para fuentes `file`. libVLC decodifica por
 * SOFTWARE, así que reproduce HEVC/DTS/mkv que ExoPlayer no puede en hardware
 * flojo o en el emulador — la misma razón por la que iOS usa VLCKit. Los
 * controles de transporte por cruceta son idénticos al motor expo-video.
 *
 * Paridad completa con el motor expo-video: transporte + resume + fallback +
 * overlay del subtítulo español + menú de opciones por la tuerca
 * (Audio/Subtítulos/Estilo/Calidad/Pantalla). VLC expone las pistas nativas en
 * onLoad (id numérico) y se seleccionan por selectedAudioTrack/selectedTextTrack.
 */
function VlcPlayback({
  info, startAt, meta, title, srtCues, offsetKey,
  audioLang, sources, sourcesLoading, activeSourceIndex,
  onExit, onSourceFailed, onChangeAudioLang, onPickSource, onPosition,
}: PlaybackProps) {
  const isTv = meta.media_type === 'tv'
  const uri = info.streamUrl // este motor solo maneja fuentes 'file'
  const referer = info.referer

  const vlcRef = useRef<VideoVLCRef>(null)
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [filled, setFilled] = useState(false)

  // Menú de opciones (Audio/Subtítulos/Estilo/Calidad/Pantalla), idéntico al del
  // motor expo-video. null = cerrado. La tuerca de la barra lo abre.
  const [menuTab, setMenuTab] = useState<MenuTabKey | null>(null)
  const menuTabRef = useRef(menuTab)
  menuTabRef.current = menuTab

  // Pistas nativas que expone VLC en onLoad (audio/subtítulos con id NUMÉRICO).
  // Las adaptamos a la forma AudioTrack/SubtitleTrack (id como string) para
  // reusar tal cual el OptionsMenu del otro motor. La selección vuelve a número
  // en las props selectedAudioTrack/selectedTextTrack.
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [currentAudioId, setCurrentAudioId] = useState<string | undefined>(undefined)

  // Subtítulo: 'external' = overlay del .srt español que dibujamos nosotros;
  // 'none' = apagado; string = id de pista nativa (la pinta VLC). Igual criterio
  // que el motor expo-video: si hay español disponible arranca ahí.
  const [subMode, setSubMode] = useState<'external' | 'none' | string>('none')
  const subModeChosenByUser = useRef(false)

  // Overlay del subtítulo español (mismo estilo/sincronía que el motor expo-video).
  const [subStyle, setSubStyleState] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  useEffect(() => { getSubtitleStyle().then(setSubStyleState) }, [])
  const [subOffset, setSubOffsetState] = useState(0)
  useEffect(() => { getSubtitleOffset(offsetKey).then(setSubOffsetState) }, [offsetKey])

  const progressRef = useRef({ time: 0, duration: 0 })
  const lastSave = useRef(0)
  const reportedFail = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const firstUri = useRef(uri)
  // Última marca de tiempo vista: si avanza entre ticks, estamos reproduciendo
  // (no buffering). El nativo solo emite onBuffer(true) y nunca false, así que
  // este es el que baja el spinner de verdad.
  const lastProgressTime = useRef(-1)

  // Cambio de fuente sin remontar (fallback file→file): la primera carga la hace
  // initialSource; las siguientes van por setSource imperativo.
  useEffect(() => {
    if (uri === firstUri.current) return
    reportedFail.current = false
    lastProgressTime.current = -1
    setBuffering(true)
    vlcRef.current?.setSource({ uri, headers: referer ? { Referer: referer } : undefined })
  }, [uri, referer])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT)
  }, [])
  useEffect(() => {
    revealControls()
    return () => clearTimeout(hideTimer.current)
  }, [revealControls])

  // Con el menú abierto los controles no se esconden solos; al cerrarlo, reprograma el auto-hide.
  useEffect(() => {
    if (menuTab) {
      clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      revealControls()
    }
  }, [menuTab, revealControls])

  // Atrás: desde un extra (Estilo/Calidad/Pantalla) vuelve a las columnas; desde
  // 'main' cierra el menú; sin menú, deja salir del reproductor.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const t = menuTabRef.current
      if (t && t !== 'main') { setMenuTab('main'); return true }
      if (t === 'main') { setMenuTab(null); return true }
      return false
    })
    return () => sub.remove()
  }, [])

  const togglePlay = useCallback(() => setPaused((p) => !p), [])

  const seekBy = useCallback((delta: number) => {
    const dur = progressRef.current.duration || Infinity
    const next = Math.max(0, Math.min(dur, progressRef.current.time + delta))
    vlcRef.current?.seek(next)
    setPosition(next)
    progressRef.current.time = next
  }, [])

  const handleLoad = useCallback((e: OnLoadData) => {
    setBuffering(false)
    if (e.duration > 0) setDuration(e.duration)
    // Adaptamos las pistas de VLC (id numérico) a la forma del OptionsMenu.
    setAudioTracks(
      e.audioTracks.map((t) => ({
        id: String(t.id), language: t.language ?? '', label: t.title || t.language || '',
      }))
    )
    setSubtitleTracks(
      e.textTracks.map((t) => ({
        id: String(t.id), language: t.language ?? '', label: t.title || t.language || '',
      }))
    )
    const selAudio = e.audioTracks.find((t) => t.selected)
    if (selAudio) setCurrentAudioId(String(selAudio.id))
  }, [])

  // Auto-selección de subtítulo (una vez, sin pisar una elección manual):
  // 1) el overlay .srt español si llegó; 2) una pista nativa en español.
  useEffect(() => {
    if (subModeChosenByUser.current) return
    if (srtCues.length > 0) { setSubMode('external'); return }
    const es = subtitleTracks.find(isSpanish)
    if (es?.id) setSubMode(es.id)
  }, [srtCues, subtitleTracks])

  const handleProgress = useCallback((e: OnProgressData) => {
    const t = e.currentTime
    const dur = e.seekableDuration
    // El tiempo avanzó ⇒ está reproduciendo, no buffering. Este es el único que
    // apaga el spinner de forma fiable (el nativo solo emite onBuffer(true)).
    if (t > lastProgressTime.current) setBuffering(false)
    lastProgressTime.current = t
    progressRef.current = { time: t, duration: dur }
    setPosition(t)
    onPosition(t)
    if (dur > 0) setDuration(dur)
    const now = Date.now()
    if (dur > 0 && t > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...meta, position: t, duration: dur })
    }
  }, [meta, onPosition])

  const handleError = useCallback((e: OnVideoErrorData) => {
    if (reportedFail.current) return
    reportedFail.current = true
    onSourceFailed(info.source, e?.error?.errorString ?? 'Error de reproducción (VLC)')
  }, [info.source, onSourceFailed])

  // VLC emite EndReached (→ onEnd) NO solo al terminar el contenido, sino también
  // cuando reemplazamos el media en un swap de fuente (fallback / cambio de audio).
  // Si saliéramos siempre, cambiar de audio cerraba el reproductor. Salimos solo
  // si de verdad estamos al final (posición pegada a la duración).
  const handleEnd = useCallback(() => {
    const { time, duration: d } = progressRef.current
    if (d > 0 && time >= d - 1.5) onExit()
  }, [onExit])

  // Selección de pistas → props del componente. VLC usa ids numéricos y -1 apaga
  // los subtítulos nativos (modos 'external'/'none', que van por overlay o nada).
  const selectedAudioTrack = currentAudioId != null ? Number(currentAudioId) : undefined
  const nativeSubActive = subMode !== 'external' && subMode !== 'none'
  const selectedTextTrack = nativeSubActive ? Number(subMode) : -1
  // Sincronía de la pista de subtítulo NATIVA vía spuDelay de VLC. El prop nativo
  // toma segundos ENTEROS (los pasa a microsegundos), así que redondeamos; el
  // overlay .srt (modo 'external') sigue usando subOffset con precisión fina.
  const textTrackDelay = nativeSubActive ? Math.round(subOffset) : 0

  const selectAudioTrack = useCallback((t: AudioTrack) => {
    if (t.id != null) setCurrentAudioId(t.id)
  }, [])
  const chooseSubMode = useCallback((mode: 'external' | 'none' | string) => {
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
      const next = Math.round(Math.min(30, Math.max(-30, prev + delta)) * 10) / 10
      setSubtitleOffset(offsetKey, next)
      return next
    })
  }, [offsetKey])

  // Guarda el progreso final al salir.
  useEffect(() => {
    return () => {
      const { time, duration: d } = progressRef.current
      if (d > 0) saveProgress({ ...meta, position: time, duration: d })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useTVEventHandler((evt) => {
    if (evt?.eventType === 'playPause') { revealControls(); togglePlay() }
  })

  const pct = duration > 0 ? Math.min(1, position / duration) : 0
  const remaining = Math.max(0, duration - position)
  // El overlay JS solo se dibuja en modo 'external'; las pistas nativas las pinta VLC.
  const activeCue = subMode === 'external' ? findActiveCue(srtCues, position - subOffset) : null
  const baseTitle = title.replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, '')
  const episodeLabel = isTv ? `T${meta.season ?? 1} · E${meta.episode ?? 1}` : undefined

  return (
    <View style={styles.playerRoot}>
      <VideoVLC
        ref={vlcRef}
        style={StyleSheet.absoluteFill}
        initialSource={{
          uri,
          headers: referer ? { Referer: referer } : undefined,
          // Retomar unos segundos antes, como el otro motor.
          startPosition: startAt > 5 ? Math.max(0, Math.round(startAt - 3)) : 0,
        }}
        paused={paused}
        resizeMode={filled ? 'cover' : 'none'}
        progressUpdateInterval={500}
        selectedAudioTrack={selectedAudioTrack}
        selectedTextTrack={selectedTextTrack}
        textTrackDelay={textTrackDelay}
        onLoad={handleLoad}
        onProgress={handleProgress}
        onBuffer={(e) => setBuffering(e.isBuffering)}
        onError={handleError}
        onEnd={handleEnd}
      />

      {/* Overlay del subtítulo español (dibujado por JS, igual que en expo-video). */}
      {activeCue && (
        <View style={styles.subtitleOverlay} pointerEvents="none">
          <Text
            style={[
              styles.subtitleText,
              {
                fontSize: SUBTITLE_FONT_SIZE[subStyle.size],
                color: SUBTITLE_COLOR_CSS[subStyle.color],
                backgroundColor: subStyle.background === 'semi' ? 'rgba(0,0,0,0.6)' : 'transparent',
              },
            ]}
          >
            {activeCue.text}
          </Text>
        </View>
      )}

      {buffering && !paused && (
        <View style={styles.bufferBadge} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}

      {!menuTab && (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {controlsVisible && (
          <>
            <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} style={styles.scrimTop} pointerEvents="none" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} style={styles.scrimBottom} pointerEvents="none" />
          </>
        )}

        <View style={[styles.controls, { opacity: controlsVisible ? 1 : 0 }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <IconBtn
              onFocus={revealControls}
              onPress={onExit}
              render={(f) => <Ionicons name="chevron-back" size={30} color={f ? '#000' : '#fff'} />}
            />
          </View>

          <View style={styles.bottomBlock}>
            <View style={styles.metaRow}>
              <View style={styles.metaText}>
                <Text style={styles.title} numberOfLines={1}>{baseTitle}</Text>
                {!!episodeLabel && <Text style={styles.episode} numberOfLines={1}>{episodeLabel}</Text>}
              </View>
              <Text style={styles.remaining}>-{fmt(remaining)}</Text>
            </View>

            <View style={styles.timeline}>
              <View style={[styles.timelineFill, { width: `${pct * 100}%` }]} />
              <View style={[styles.knob, { left: `${pct * 100}%` }]} />
            </View>

            <View style={styles.controlRow}>
              <View style={styles.sideGroup} />
              <View style={styles.centerGroup}>
                <IconBtn
                  onFocus={revealControls}
                  onPress={() => { revealControls(); seekBy(-SEEK_STEP) }}
                  render={(f) => <MaterialIcons name="replay-10" size={34} color={f ? '#000' : '#fff'} />}
                />
                <IconBtn
                  big
                  hasTVPreferredFocus
                  onFocus={revealControls}
                  onPress={() => { revealControls(); togglePlay() }}
                  render={(f) => <Ionicons name={paused ? 'play' : 'pause'} size={40} color={f ? '#000' : '#fff'} />}
                />
                <IconBtn
                  onFocus={revealControls}
                  onPress={() => { revealControls(); seekBy(SEEK_STEP) }}
                  render={(f) => <MaterialIcons name="forward-10" size={34} color={f ? '#000' : '#fff'} />}
                />
              </View>
              <View style={[styles.sideGroup, styles.sideRight]}>
                <IconBtn
                  onFocus={revealControls}
                  onPress={() => setMenuTab('main')}
                  render={(f) => <Ionicons name="settings-outline" size={30} color={f ? '#000' : '#fff'} />}
                />
              </View>
            </View>
          </View>
        </View>
      </View>
      )}

      {menuTab && (
        <OptionsMenu
          tab={menuTab}
          onTab={setMenuTab}
          // En VLC el Estilo/Sincronía sirve también con pistas nativas (la
          // sincronía las ajusta vía spuDelay), así que lo mostramos si hay
          // cualquier subtítulo, no solo el .srt externo.
          hasStyleTab={srtCues.length > 0 || subtitleTracks.length > 0}
          syncNative
          audioLang={audioLang}
          hasLatinoAlternative={info.hasLatinoAlternative}
          audioTracks={audioTracks}
          currentAudioId={currentAudioId}
          subtitleTracks={subtitleTracks}
          hasExternalSubs={srtCues.length > 0}
          subMode={subMode}
          subStyle={subStyle}
          subOffset={subOffset}
          sources={sources}
          sourcesLoading={sourcesLoading}
          activeSourceIndex={activeSourceIndex}
          filled={filled}
          onSetFilled={setFilled}
          onChangeAudioLang={(lang) => { setMenuTab(null); onChangeAudioLang(lang) }}
          onSelectAudioTrack={selectAudioTrack}
          onChooseSubMode={chooseSubMode}
          onChangeSubStyle={changeSubStyle}
          onBumpOffset={bumpOffset}
          onPickSource={(i) => { setMenuTab(null); onPickSource(i) }}
          onClose={() => setMenuTab(null)}
        />
      )}
    </View>
  )
}

// ── Menú de opciones (estilo HBO: pantalla completa, cruceta) ───────────────
// Vista principal: dos columnas simultáneas — Subtítulos (izq) + Audio (der) —
// que se navegan con arriba/abajo dentro de cada una e izquierda/derecha entre
// ellas. Arriba a la derecha, una barra de iconos con los "extras"
// (Estilo/Calidad/Pantalla) y la X de cerrar: tocar un icono reemplaza las
// columnas por ese panel; tocarlo de nuevo (o Atrás) vuelve a las columnas.
function OptionsMenu({
  tab, onTab, hasStyleTab, syncNative,
  audioLang, hasLatinoAlternative, audioTracks, currentAudioId,
  subtitleTracks, hasExternalSubs, subMode, subStyle, subOffset,
  sources, sourcesLoading, activeSourceIndex, filled, onSetFilled,
  onChangeAudioLang, onSelectAudioTrack, onChooseSubMode,
  onChangeSubStyle, onBumpOffset, onPickSource, onClose,
}: {
  tab: MenuTabKey
  onTab: (t: MenuTabKey) => void
  hasStyleTab: boolean
  // Motor VLC: la sincronía ajusta también las pistas nativas (spuDelay). En
  // expo-video la sincronía solo mueve el overlay .srt.
  syncNative?: boolean
  audioLang: AudioLang
  hasLatinoAlternative: boolean
  audioTracks: AudioTrack[]
  currentAudioId: string | undefined
  subtitleTracks: SubtitleTrack[]
  hasExternalSubs: boolean
  subMode: 'external' | 'none' | string
  subStyle: SubtitleStyle
  subOffset: number
  sources: SourceOption[]
  sourcesLoading: boolean
  activeSourceIndex: number | null
  filled: boolean
  onSetFilled: (v: boolean) => void
  onChangeAudioLang: (lang: AudioLang) => void
  onSelectAudioTrack: (t: AudioTrack) => void
  onChooseSubMode: (mode: 'external' | 'none' | string) => void
  onChangeSubStyle: (patch: Partial<SubtitleStyle>) => void
  onBumpOffset: (delta: number) => void
  onPickSource: (i: number) => void
  onClose: () => void
}) {
  // Iconos de la barra superior: los "extras" que no caben como columnas. Estilo
  // solo aparece si hay subtítulo externo (mismo criterio que hasStyleTab).
  const extras: { key: 'style' | 'quality' | 'screen'; icon: keyof typeof Ionicons.glyphMap }[] = [
    ...(hasStyleTab ? [{ key: 'style' as const, icon: 'text' as const }] : []),
    { key: 'quality', icon: 'options' as const },
    { key: 'screen', icon: 'expand' as const },
  ]
  const panelTitle =
    tab === 'style' ? 'Estilo' : tab === 'quality' ? 'Calidad' : tab === 'screen' ? 'Pantalla' : ''

  return (
    <View style={styles.menuRoot}>
      {/* Zona muerta que absorbe un toque para cerrar (por si hay puntero). No
          enfocable: si participara del foco por cruceta le robaría el foco a las
          columnas/opciones. */}
      <Pressable style={StyleSheet.absoluteFill} focusable={false} onPress={onClose} />

      {/* Barra superior: iconos de extras + cerrar, alineados a la derecha. */}
      <View style={styles.menuHeader}>
        {extras.map((e) => (
          <TopIcon
            key={e.key}
            icon={e.icon}
            active={tab === e.key}
            onPress={() => onTab(tab === e.key ? 'main' : e.key)}
          />
        ))}
        <TopIcon icon="close" onPress={onClose} />
      </View>

      <View style={styles.menuBody}>
        {tab === 'main' ? (
          <View style={styles.menuColumns}>
            <MenuColumn title="Subtítulos">
              <SubsTabContent
                subtitleTracks={subtitleTracks}
                hasExternalSubs={hasExternalSubs}
                subMode={subMode}
                onChooseSubMode={onChooseSubMode}
                firstFocus
              />
            </MenuColumn>
            <MenuColumn title="Audio">
              <AudioTabContent
                audioLang={audioLang}
                hasLatinoAlternative={hasLatinoAlternative}
                audioTracks={audioTracks}
                currentAudioId={currentAudioId}
                onChangeAudioLang={onChangeAudioLang}
                onSelectAudioTrack={onSelectAudioTrack}
              />
            </MenuColumn>
          </View>
        ) : (
          <View style={styles.panelWrap}>
            <Text style={styles.columnHeader}>{panelTitle}</Text>
            {tab === 'style' && (
              <StyleTabContent
                subStyle={subStyle}
                subOffset={subOffset}
                subMode={subMode}
                syncNative={syncNative}
                onChangeSubStyle={onChangeSubStyle}
                onBumpOffset={onBumpOffset}
              />
            )}
            {tab === 'quality' && (
              <QualityTabContent
                sources={sources}
                sourcesLoading={sourcesLoading}
                activeSourceIndex={activeSourceIndex}
                onPickSource={onPickSource}
              />
            )}
            {tab === 'screen' && (
              <ScreenTabContent filled={filled} onSetFilled={onSetFilled} />
            )}
          </View>
        )}
      </View>

      {tab === 'main' && (
        <View style={styles.menuFooter}>
          <Text style={styles.menuFooterText}>
            Arriba a la derecha: {hasStyleTab ? 'Estilo · ' : ''}Calidad · Pantalla
          </Text>
        </View>
      )}
    </View>
  )
}

function AudioTabContent({
  audioLang, hasLatinoAlternative, audioTracks, currentAudioId,
  onChangeAudioLang, onSelectAudioTrack,
}: {
  audioLang: AudioLang
  hasLatinoAlternative: boolean
  audioTracks: AudioTrack[]
  currentAudioId: string | undefined
  onChangeAudioLang: (lang: AudioLang) => void
  onSelectAudioTrack: (t: AudioTrack) => void
}) {
  const noSpanish = audioLang === 'latino' && audioTracks.length > 0 && !audioTracks.some(isSpanish)
  return (
    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
      <ListItem
        label={
          audioLang === 'latino'
            ? 'Volver a audio Original'
            : hasLatinoAlternative
              ? 'Cambiar a fuente con audio Latino'
              : 'Buscar fuente con audio Latino'
        }
        onPress={() => onChangeAudioLang(audioLang === 'latino' ? 'original' : 'latino')}
      />
      {noSpanish && (
        <Text style={styles.menuNotice}>
          Esta fuente no trae audio en español. Probá con otra en Calidad.
        </Text>
      )}
      {audioTracks.map((t, idx) => (
        <ListItem
          key={t.id ?? idx}
          label={t.label || t.language || `Pista ${idx + 1}`}
          selected={t.id === currentAudioId}
          onPress={() => onSelectAudioTrack(t)}
        />
      ))}
      {audioTracks.length === 0 && (
        <Text style={styles.menuEmpty}>Esta fuente solo trae una pista de audio</Text>
      )}
    </ScrollView>
  )
}

function SubsTabContent({
  subtitleTracks, hasExternalSubs, subMode, onChooseSubMode, firstFocus,
}: {
  subtitleTracks: SubtitleTrack[]
  hasExternalSubs: boolean
  subMode: 'external' | 'none' | string
  onChooseSubMode: (mode: 'external' | 'none' | string) => void
  firstFocus?: boolean
}) {
  return (
    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
      {/* "Apagado" primero, como HBO, y es quien recibe el foco inicial. */}
      <ListItem
        label="Apagado"
        selected={subMode === 'none'}
        hasTVPreferredFocus={firstFocus}
        onPress={() => onChooseSubMode('none')}
      />
      {hasExternalSubs && (
        <ListItem
          label="Español"
          selected={subMode === 'external'}
          onPress={() => onChooseSubMode('external')}
        />
      )}
      {subtitleTracks.map((t, idx) => (
        <ListItem
          key={t.id ?? idx}
          label={t.label || t.language || `Subtítulo ${idx + 1}`}
          selected={subMode === t.id}
          onPress={() => t.id && onChooseSubMode(t.id)}
        />
      ))}
      {!hasExternalSubs && subtitleTracks.length === 0 && (
        <Text style={styles.menuEmpty}>Esta fuente no trae subtítulos</Text>
      )}
    </ScrollView>
  )
}

function StyleTabContent({
  subStyle, subOffset, subMode, syncNative, onChangeSubStyle, onBumpOffset,
}: {
  subStyle: SubtitleStyle
  subOffset: number
  subMode: 'external' | 'none' | string
  syncNative?: boolean
  onChangeSubStyle: (patch: Partial<SubtitleStyle>) => void
  onBumpOffset: (delta: number) => void
}) {
  const nativeSubActive = typeof subMode === 'string' && subMode !== 'external' && subMode !== 'none'
  return (
    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
      <ChipRow
        label="Tamaño"
        value={subStyle.size}
        firstFocus
        options={[
          { value: 'small', label: 'Chico' },
          { value: 'medium', label: 'Medio' },
          { value: 'large', label: 'Grande' },
        ]}
        onChange={(size) => onChangeSubStyle({ size })}
      />
      <ChipRow
        label="Color"
        value={subStyle.color}
        options={[
          { value: 'white', label: 'Blanco' },
          { value: 'yellow', label: 'Amarillo' },
          { value: 'cyan', label: 'Cian' },
        ]}
        onChange={(color) => onChangeSubStyle({ color })}
      />
      <ChipRow
        label="Fondo"
        value={subStyle.background}
        options={[
          { value: 'none', label: 'Ninguno' },
          { value: 'semi', label: 'Semi' },
        ]}
        onChange={(background) => onChangeSubStyle({ background })}
      />

      <View style={styles.syncRow}>
        <Text style={styles.styleLabel}>Sincronía</Text>
        <View style={styles.syncControls}>
          <SmallButton label="−0,5s" onPress={() => onBumpOffset(-0.5)} />
          <SmallButton
            label={subOffset === 0 ? '0s' : `${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)}s`}
            onPress={() => onBumpOffset(-subOffset)}
          />
          <SmallButton label="+0,5s" onPress={() => onBumpOffset(0.5)} />
        </View>
      </View>
      <Text style={styles.menuHint}>
        Si el texto va adelantado, subí el valor. El número del medio vuelve a 0.
      </Text>
      {nativeSubActive && (
        <Text style={styles.menuNotice}>
          {syncNative
            ? 'Estás viendo una pista incrustada: el tamaño/color/fondo solo aplican al subtítulo en español que descargamos; la sincronía sí ajusta esta pista (en pasos de 1 s).'
            : 'Estás viendo una pista incrustada: estos ajustes solo se aplican al subtítulo en español que descargamos.'}
        </Text>
      )}
    </ScrollView>
  )
}

function QualityTabContent({
  sources, sourcesLoading, activeSourceIndex, onPickSource,
}: {
  sources: SourceOption[]
  sourcesLoading: boolean
  activeSourceIndex: number | null
  onPickSource: (i: number) => void
}) {
  if (sourcesLoading) {
    return (
      <View style={styles.menuLoading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }
  if (sources.length === 0) {
    return (
      <View style={styles.menuList}>
        <Text style={styles.menuEmpty}>No hay otras fuentes disponibles</Text>
      </View>
    )
  }
  return (
    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
      {sources.map((s, idx) => (
        <ListItem
          key={s.i}
          label={describeSource(s)}
          sub={s.label}
          selected={s.i === activeSourceIndex}
          hasTVPreferredFocus={idx === 0}
          onPress={() => onPickSource(s.i)}
        />
      ))}
    </ScrollView>
  )
}

// Ajuste de imagen: "Ajustar" (contain, se ve el frame completo) vs "Llenar"
// (cover, recorta los bordes para ocupar toda la pantalla). Antes era un botón
// suelto en la barra; ahora vive acá, dentro del menú de opciones.
function ScreenTabContent({
  filled, onSetFilled,
}: {
  filled: boolean
  onSetFilled: (v: boolean) => void
}) {
  return (
    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
      <ChipRow
        label="Ajuste de imagen"
        value={filled ? 'fill' : 'fit'}
        firstFocus
        onChange={(v) => onSetFilled(v === 'fill')}
        options={[
          { value: 'fit', label: 'Ajustar' },
          { value: 'fill', label: 'Llenar' },
        ]}
      />
      <Text style={styles.menuHint}>
        «Ajustar» muestra el cuadro completo. «Llenar» recorta los bordes para
        que la imagen ocupe toda la pantalla.
      </Text>
    </ScrollView>
  )
}

// ── Componentes enfocables reutilizables ────────────────────────────────────

// Columna del menú principal (Subtítulos / Audio): título arriba + su lista.
function MenuColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.menuColumn}>
      <Text style={styles.columnHeader}>{title}</Text>
      {children}
    </View>
  )
}

// Icono de la barra superior del menú (extras + cerrar). `active` marca el panel
// abierto; al enfocarse pasa a fondo blanco con ícono oscuro, como el resto.
function TopIcon({
  icon, active, hasTVPreferredFocus, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  active?: boolean
  hasTVPreferredFocus?: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} hasTVPreferredFocus={hasTVPreferredFocus}>
      {({ focused }) => (
        <View style={[styles.topIcon, active && styles.topIconActive, focused && styles.topIconFocused]}>
          <Ionicons name={icon} size={24} color={focused ? '#000' : active ? colors.text : colors.textDim} />
        </View>
      )}
    </Pressable>
  )
}

// Fila de opción estilo HBO: tilde a la IZQUIERDA (hueco fijo para que los
// textos queden alineados estén o no seleccionados), etiqueta y subtítulo
// opcional. Al enfocarse pinta el fondo blanco y el texto/tilde en oscuro.
function ListItem({
  label, sub, selected, hasTVPreferredFocus, onPress,
}: {
  label: string
  sub?: string
  selected?: boolean
  hasTVPreferredFocus?: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} hasTVPreferredFocus={hasTVPreferredFocus}>
      {({ focused }) => (
        <View style={[styles.listItem, focused && styles.listItemFocused]}>
          <View style={styles.checkSlot}>
            {selected && <Ionicons name="checkmark" size={20} color={focused ? '#000' : colors.text} />}
          </View>
          <View style={styles.listItemLabels}>
            <Text style={[styles.listItemText, focused && styles.listItemTextFocused]} numberOfLines={1}>
              {label}
            </Text>
            {!!sub && (
              <Text style={[styles.listItemSub, focused && styles.listItemSubFocused]} numberOfLines={1}>
                {sub}
              </Text>
            )}
          </View>
        </View>
      )}
    </Pressable>
  )
}

function ChipRow<T extends string>({
  label, value, options, firstFocus, onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  firstFocus?: boolean
  onChange: (v: T) => void
}) {
  return (
    <View style={styles.styleRow}>
      <Text style={styles.styleLabel}>{label}</Text>
      <View style={styles.styleChips}>
        {options.map((opt, idx) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={opt.value === value}
            hasTVPreferredFocus={firstFocus && idx === 0}
            onPress={() => onChange(opt.value)}
          />
        ))}
      </View>
    </View>
  )
}

function Chip({
  label, selected, hasTVPreferredFocus, onPress,
}: {
  label: string
  selected?: boolean
  hasTVPreferredFocus?: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} hasTVPreferredFocus={hasTVPreferredFocus}>
      {({ focused }) => (
        <View style={[styles.chip, selected && styles.chipSelected, focused && styles.chipFocused]}>
          <Text
            style={[
              styles.chipText,
              selected && styles.chipTextSelected,
              focused && styles.chipTextFocused,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      {({ focused }) => (
        <View style={[styles.smallBtn, focused && styles.smallBtnFocused]}>
          <Text style={[styles.smallBtnText, focused && styles.smallBtnTextFocused]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

// Botón de ícono enfocable. Al enfocarse se agranda (spring) y pasa a fondo
// blanco con ícono oscuro (máximo contraste desde lejos). `render` recibe el
// estado de foco para pintar el ícono del color correcto. Mismo patrón que
// FocusButton (Pressable + onPress), que es el que responde bien a la cruceta.
function IconBtn({
  render, big, hasTVPreferredFocus, onPress, onFocus,
}: {
  render: (focused: boolean) => ReactNode
  big?: boolean
  hasTVPreferredFocus?: boolean
  onPress: () => void
  onFocus?: () => void
}) {
  const scale = useRef(new Animated.Value(1)).current
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 7 }).start()
  const size = big ? 64 : 48
  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => { animate(1.12); onFocus?.() }}
      onBlur={() => animate(1)}
    >
      {({ focused }) => (
        <Animated.View
          style={[
            styles.iconBtn,
            focused && styles.iconBtnFocused,
            { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] },
          ]}
        >
          {render(focused)}
        </Animated.View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: safe.horizontal,
  },
  loadingText: { fontSize: 15, color: colors.textDim },
  errorTitle: heroTitle,
  errorHint: { fontSize: 14, color: colors.textDim, textAlign: 'center', maxWidth: 620 },

  playerRoot: { flex: 1, backgroundColor: '#000' },
  bufferBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  subtitleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: safe.bottom + 24,
    alignItems: 'center',
    paddingHorizontal: safe.horizontal,
  },
  subtitleText: {
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '22%' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },

  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingHorizontal: safe.horizontal,
    paddingTop: safe.top,
    paddingBottom: safe.bottom,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },

  bottomBlock: { gap: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 },
  metaText: { flex: 1, gap: 2 },
  title: { ...heroTitle, fontSize: 28 },
  episode: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  remaining: { fontSize: 15, color: '#fff', fontWeight: '600', fontVariant: ['tabular-nums'] },

  timeline: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  timelineFill: { height: '100%', borderRadius: 3, backgroundColor: '#fff' },
  knob: {
    position: 'absolute',
    top: '50%',
    width: 15,
    height: 15,
    borderRadius: 8,
    marginTop: -7.5,
    marginLeft: -7.5,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },

  controlRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  sideGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sideRight: { justifyContent: 'flex-end' },
  centerGroup: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  iconBtnFocused: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },

  // ── Menú de opciones (estilo HBO: pantalla completa, columnas simultáneas) ──
  menuRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,8,10,0.94)',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: safe.top,
    paddingHorizontal: safe.horizontal,
    paddingBottom: 6,
  },
  topIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  topIconActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
  topIconFocused: { backgroundColor: colors.text },

  menuBody: { flex: 1, paddingHorizontal: safe.horizontal, paddingTop: 4 },
  menuColumns: { flex: 1, flexDirection: 'row', gap: 56 },
  menuColumn: { flex: 1 },
  panelWrap: { flex: 1, maxWidth: 760 },
  columnHeader: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  menuScroll: { flex: 1 },
  menuList: { gap: 2, paddingBottom: 24 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  listItemFocused: { backgroundColor: colors.text },
  checkSlot: { width: 22, alignItems: 'center' },
  listItemLabels: { flex: 1, gap: 2 },
  listItemText: { fontSize: 18, fontWeight: '600', color: colors.text },
  listItemTextFocused: { color: '#000' },
  listItemSub: { fontSize: 12, color: colors.textDim },
  listItemSubFocused: { color: 'rgba(0,0,0,0.6)' },

  menuFooter: {
    paddingHorizontal: safe.horizontal,
    paddingBottom: safe.bottom,
    paddingTop: 6,
  },
  menuFooterText: { fontSize: 13, color: colors.textDim },

  menuEmpty: { fontSize: 14, color: colors.textDim, paddingHorizontal: 16, paddingVertical: 12 },
  menuNotice: {
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  menuHint: { fontSize: 12, color: colors.textDim, paddingHorizontal: 16, paddingTop: 2 },
  menuLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Estilo de subtítulos
  styleRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  styleLabel: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  styleChips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipSelected: { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipFocused: { backgroundColor: colors.text },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  chipTextSelected: { color: colors.text },
  chipTextFocused: { color: '#000' },

  syncRow: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  syncControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    minWidth: 64,
    alignItems: 'center',
  },
  smallBtnFocused: { backgroundColor: colors.text },
  smallBtnText: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  smallBtnTextFocused: { color: '#000' },
})
