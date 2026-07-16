import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Animated, Pressable, ScrollView,
} from 'react-native'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEventListener } from 'expo'
import { SymbolView } from 'expo-symbols'
import Slider from '@react-native-community/slider'
import * as ScreenOrientation from 'expo-screen-orientation'
import { GestureHandlerRootView, PinchGestureHandler, State as GHState } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream, getAudioLang, setAudioLang as persistAudioLang, type AudioLang, type Subtitle } from '@/lib/stream'
import { saveProgress, getProgress, setUpNext, type Progress } from '@/lib/library'
import { backdropUrl, tmdb } from '@/lib/tmdb'
import { getLocalPath, smartDownloadNext } from '@/lib/download'
import { Touchable } from '@/components/Touchable'
import VideoVLC from '@/vendor/react-native-video-vlc/src/VideoVLC'
import type {
  VideoVLCRef,
  OnLoadData, OnProgressData, OnVideoErrorData, OnBufferData,
} from '@/vendor/react-native-video-vlc/src'

const COUNTDOWN_S = 8
const FINISHED_RATIO = 0.9 // visto "completo" → ofrecer siguiente episodio
const NEXT_PILL_S = 50      // segundos finales en que aparece el pill "Siguiente"
const SAVE_EVERY_MS = 5000  // throttle de guardado de progreso (evita I/O por segundo)

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string; id: string; season?: string; episode?: string
    title?: string; poster?: string; backdrop?: string; episodeTitle?: string
    localPath?: string   // si viene con ruta local, reproducir sin resolver
  }>()
  const { type, id, season, episode, title } = params
  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  // El episodio es estado interno → cambiar de episodio NO renavega (transición fluida)
  const [episodeN, setEpisodeN] = useState(episode ? Number(episode) : undefined)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [streamType, setStreamType] = useState<'hls' | 'file'>('hls')
  const [referer, setReferer] = useState('')
  const [subtitles, setSubtitles] = useState<Subtitle[]>([])
  const [showNext, setShowNext] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Idioma de audio: 'original' (subtitulado) | 'latino' (doblaje). Persistido.
  const [audioLang, setAudioLangState] = useState<AudioLang>('original')
  useEffect(() => { getAudioLang().then(setAudioLangState) }, [])

  // No forzamos orientación: el fullscreen nativo de Apple (AVPlayerViewController)
  // rota a horizontal por su cuenta y vuelve a vertical al salir, sin saltos.
  // La vista que queda detrás permanece en portrait → no se ve ninguna rotación.
  function exitToBack() {
    router.back()
  }

  // Episodios de la temporada actual (para saber si hay siguiente)
  const [seasonEps, setSeasonEps] = useState<number[]>([])
  useEffect(() => {
    if (!isTv) return
    let cancelled = false
    tmdb.season(id, seasonN ?? 1)
      .then((s) => {
        if (!cancelled) setSeasonEps(s.episodes.map((e) => e.episode_number))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isTv, id, seasonN])

  const nextEpisodeN = (episodeN ?? 1) + 1
  const hasNextEpisode = isTv && seasonEps.includes(nextEpisodeN)

  function retry() {
    setError(null)
    setReady(false)
    setStreamUrl(null)
    setRetryCount((c) => c + 1)
  }

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      // 1. Chequear si hay descarga local para este contenido
      const local = params.localPath
        || await getLocalPath(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN)

      const pos = await getProgress(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN)
      if (cancelled) return

      if (local) {
        // Reproducción offline: la URI ya es el m3u8 local
        setReferer('')
        setStartAt(pos)
        setReady(true)
        return
      }

      // 2. Resolución normal vía API (con el idioma de audio preferido)
      const resolveP = isTv
        ? stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1, audioLang)
        : stream.resolveMovie(id, audioLang)

      const info = await resolveP
      if (cancelled) return
      setStreamUrl(info.streamUrl)
      setStreamType(info.type ?? 'hls')
      setReferer(info.referer)
      setSubtitles(info.subtitles ?? [])
      setStartAt(pos)
      setReady(true)

      // Pre-resuelve el siguiente episodio en segundo plano
      if (isTv) stream.prewarm('tv', id, seasonN ?? 1, (episodeN ?? 1) + 1, audioLang)
    }

    resolve().catch((e) => !cancelled && setError(String(e)))
    return () => { cancelled = true }
  }, [type, id, seasonN, episodeN, retryCount, audioLang])

  // Si existe descarga local, el player la usará directamente (sin pasar por API)
  const [localUri, setLocalUri] = useState<string | null>(params.localPath ?? null)
  useEffect(() => {
    getLocalPath(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN).then(setLocalUri)
  }, [id, isTv, seasonN, episodeN])

  // URI final para la vía expo-video/HLS:
  //  - local: m3u8 descargado
  //  - hls: master proxeado por nuestro servidor (variantes + segmentos + subs)
  // Las fuentes "file" (mp4/mkv de Real-Debrid) van por VLCKit directo al CDN
  // (ver isVlcSource más abajo) — no pasan por esta rama.
  const masterUrl = localUri
    ?? (isTv
      ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1, audioLang)
      : stream.masterMovie(id, audioLang))

  // Fuentes "file" (Real-Debrid, mp4/mkv) → VLCKit: soporta mkv nativo y
  // permite sideload/selección de subtítulos y pistas de audio sin re-resolver.
  const isVlcSource = streamType === 'file' && !localUri && !!streamUrl

  // Subtítulos para VLCKit: las fuentes "file" no traen subs embebidos casi
  // nunca, así que los buscamos aparte (Wyzie, vía /stream/sub.vtt) y los
  // sideloadeamos. Solo el español — el resto (en/pt) no aporta acá.
  const vlcTextTracks = subtitles
    .filter((s) => s.lang === 'es')
    .map((s) => ({
      uri: stream.subVtt(isTv ? 'tv' : 'movie', id, s.i, seasonN, episodeN, audioLang),
      language: s.lang,
      title: s.label,
    }))

  // Cambia el idioma de audio: persiste, resetea y deja que el effect re-resuelva
  function changeAudioLang(lang: AudioLang) {
    if (lang === audioLang) return
    persistAudioLang(lang)
    setReady(false)
    setStreamUrl(null)
    setError(null)
    setAudioLangState(lang)
  }

  // Título base: quita el sufijo "· T_:E_" si vino en el param
  const baseTitle = (title ?? '').replace(/\s*·\s*T\d+:E\d+\s*$/, '')

  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    title: title ?? '',
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  // Encola el siguiente episodio en "Seguir viendo"
  function enqueueNext() {
    setUpNext({
      id: Number(id),
      media_type: 'tv',
      title: title ?? '',
      poster_path: params.poster ?? null,
      backdrop_path: params.backdrop ?? null,
      season: seasonN ?? 1,
      episode: nextEpisodeN,
    }).catch(() => {})
  }

  // El usuario cerró el reproductor (botón X)
  function handleClose(watchedFraction: number) {
    if (isTv && watchedFraction >= FINISHED_RATIO && hasNextEpisode) {
      enqueueNext()
      setShowNext(true)
    } else {
      exitToBack()
    }
  }

  // El video llegó al final
  function handleEnded() {
    if (isTv && hasNextEpisode) {
      // Smart download: pre-descarga el episodio siguiente al siguiente
      smartDownloadNext({
        id: Number(id),
        title: (title ?? '').replace(/\s*·\s*T\d+:E\d+\s*$/, ''),
        poster_path: params.poster ?? null,
        backdrop_path: params.backdrop ?? null,
        season: seasonN ?? 1,
        currentEpisode: episodeN ?? 1,
        seasonEpisodeNumbers: seasonEps,
      })
      setShowNext(true)
    } else {
      exitToBack()
    }
  }

  // Cambia de episodio SIN renavegar: resetea y deja que el effect re-resuelva
  function playNextEpisode() {
    setShowNext(false)
    setReady(false)
    setStreamUrl(null)
    setStartAt(0)
    setEpisodeN(nextEpisodeN)
  }

  // ── Pantalla "Siguiente episodio" (al terminar) ──
  if (showNext) {
    return (
      <NextEpisodeScreen
        title={title ?? ''}
        season={seasonN ?? 1}
        episode={nextEpisodeN}
        backdrop={params.backdrop ?? null}
        onPlay={playNextEpisode}
        onBack={exitToBack}
      />
    )
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {error ? (
        <View style={styles.center}>
          <SymbolView name="film.stack" tintColor="rgba(255,255,255,0.4)" style={styles.errIcon} />
          <Text style={styles.errText}>No se pudo cargar</Text>
          <Text style={styles.errSub}>{error}</Text>
          <View style={styles.errButtons}>
            <Touchable scaleTo={0.95} haptic="light" style={styles.retry} onPress={retry}>
              <SymbolView name="arrow.clockwise" tintColor="#000" style={styles.retryIcon} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Touchable>
            <Touchable scaleTo={0.95} haptic="light" style={styles.errBackBtn} onPress={exitToBack}>
              <Text style={styles.errBackText}>Volver</Text>
            </Touchable>
          </View>
        </View>
      ) : ready && isVlcSource && streamUrl ? (
        <VlcPlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}-vlc`}
          uri={streamUrl}
          referer={referer}
          sideloadTextTracks={vlcTextTracks}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onError={(msg) => setError(msg || 'Player error')}
        />
      ) : ready && !isVlcSource && masterUrl ? (
        <NativePlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}-hls`}
          uri={masterUrl}
          referer={referer}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onError={(msg) => setError(msg || 'Player error')}
        />
      ) : (
        <LoadingScreen
          title={baseTitle}
          episodeLabel={isTv && season ? `T${season}:E${episode}` : undefined}
          backdrop={params.backdrop ?? null}
          audioLang={audioLang}
          showAudioSwitch={!localUri}
          onChangeAudioLang={changeAudioLang}
        />
      )}
    </GestureHandlerRootView>
  )
}

// ── Pantalla de carga: mínima, rápida, con selector de audio discreto ───────

function LoadingScreen({
  title, episodeLabel, backdrop, audioLang, showAudioSwitch, onChangeAudioLang,
}: {
  title: string
  episodeLabel?: string
  backdrop: string | null
  audioLang: AudioLang
  showAudioSwitch: boolean
  onChangeAudioLang: (lang: AudioLang) => void
}) {
  const insets = useSafeAreaInsets()
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 350, delay: 200, useNativeDriver: true }).start()
  }, [])

  const backdropUri = backdropUrl(backdrop, 'w780')

  return (
    <View style={styles.loadingRoot}>
      {backdropUri && (
        <Image source={backdropUri} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
      )}
      <View style={styles.loadingScrim} />

      <View style={styles.loadingCenter}>
        <ActivityIndicator color="#fff" size="small" />
        {!!title && (
          <Text style={styles.loadingTitle} numberOfLines={1}>
            {title}{episodeLabel ? `  ·  ${episodeLabel}` : ''}
          </Text>
        )}
      </View>

      {/* Selector de audio: discreto, aparece un instante después para no competir
          visualmente con el spinner — la carga arranca sola con la preferencia guardada. */}
      {showAudioSwitch && (
        <Animated.View style={[styles.langSwitch, { bottom: insets.bottom + 40, opacity: fade }]}>
          <View style={styles.langSegmented}>
            {(['original', 'latino'] as const).map((opt) => (
              <Touchable
                key={opt}
                scaleTo={0.94}
                haptic="selection"
                style={[styles.langOption, audioLang === opt && styles.langOptionActive]}
                onPress={() => onChangeAudioLang(opt)}
              >
                <Text style={[styles.langOptionText, audioLang === opt && styles.langOptionTextActive]}>
                  {opt === 'original' ? 'Original' : 'Español Latino'}
                </Text>
              </Touchable>
            ))}
          </View>
        </Animated.View>
      )}
    </View>
  )
}

// ── Player a pantalla completa con controles propios ────────────────────────

function NativePlayer({
  uri, referer, startAt, meta, hasNext, onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
}) {
  const insets = useSafeAreaInsets()
  const videoRef = useRef<VideoView>(null)
  const lastSave = useRef(0)
  const progressRef = useRef({ time: 0, duration: 0 })
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [inFullscreen, setInFullscreen] = useState(false)

  const player = useVideoPlayer(
    { uri, headers: referer ? { Referer: referer } : undefined, contentType: 'hls' },
    (p) => {
      p.timeUpdateEventInterval = 0.5
      p.bufferOptions = { preferredForwardBufferDuration: 30 }
    }
  )

  // Arrancar cuando el stream esté listo + entrar al fullscreen nativo de Apple
  // (AVPlayerViewController) — el que tiene Liquid Glass, velocidad, audio y subtítulos
  const started = useRef(false)
  useEventListener(player, 'statusChange', ({ status, error: playerError }) => {
    if (status === 'readyToPlay' && !started.current) {
      started.current = true
      if (startAt > 5) player.currentTime = startAt
      player.play()
      // pequeño delay para que la vista esté montada antes de expandir
      setTimeout(() => videoRef.current?.enterFullscreen(), 60)
    } else if (status === 'error') {
      console.warn('[player] error:', playerError?.message)
      onError(playerError?.message ?? 'Player error desconocido')
    }
  })

  // Progreso (throttle 5s) + posición para el pill "Siguiente"
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const dur = player.duration
    progressRef.current = { time: currentTime, duration: dur }
    setPosition(currentTime)
    if (dur > 0) setDuration(dur)
    const now = Date.now()
    if (dur > 0 && currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...meta, position: currentTime, duration: dur })
    }
  })

  useEventListener(player, 'playToEnd', () => onEnded())

  // Al desmontar → guarda el progreso final (el cierre lo maneja onFullscreenExit)
  useEffect(() => {
    return () => {
      const { time, duration: d } = progressRef.current
      if (d > 0) saveProgress({ ...meta, position: time, duration: d })
    }
  }, [])

  const remaining = Math.max(0, duration - position)
  const showPill = hasNext && duration > 0 && remaining > 1 && remaining <= NEXT_PILL_S

  return (
    <View style={styles.fill}>
      {/* Reproductor nativo de Apple (AVPlayerViewController fullscreen) —
          Liquid Glass, velocidad, audio y subtítulos integrados */}
      <VideoView
        ref={videoRef}
        player={player}
        style={styles.fill}
        nativeControls={true}
        allowsPictureInPicture
        contentFit="contain"
        onFullscreenEnter={() => setInFullscreen(true)}
        onFullscreenExit={() => {
          // El usuario cerró el reproductor nativo (botón "Listo"/X)
          const { time, duration: d } = progressRef.current
          onClose(d > 0 ? time / d : 0)
        }}
      />

      {/* Tapa negra sobre los controles inline (feos) hasta entrar a fullscreen */}
      {!inFullscreen && <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]} pointerEvents="none" />}

      {/* Pill "Siguiente episodio" — solo visible fuera de fullscreen
          (en fullscreen Apple controla todo el overlay) */}
      {showPill && !inFullscreen && (
        <Touchable
          scaleTo={0.95}
          haptic="medium"
          style={[styles.nextPill, { bottom: insets.bottom + 80, right: insets.right + 24 }]}
          onPress={onPlayNext}
        >
          <SymbolView name="forward.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Touchable>
      )}
    </View>
  )
}

// ── Player VLCKit (fuentes "file" — mp4/mkv de Real-Debrid) ─────────────────
// Sin chrome nativo de AVPlayer: controles propios, mínimos, con selector de
// pista de audio/subtítulos (lo que expo-video no puede dar para estas fuentes).

type TrackInfo = { id: number; label: string }

function VlcPlayer({
  uri, referer, sideloadTextTracks, startAt, meta, hasNext, onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  sideloadTextTracks: { uri: string; language: string; title: string }[]
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
}) {
  const insets = useSafeAreaInsets()
  const vlcRef = useRef<VideoVLCRef>(null)
  const lastSave = useRef(0)
  const progressRef = useRef({ time: 0, duration: 0 })
  const startedRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seeking = useRef(false)
  const seekGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSeekTarget = useRef<number | null>(null)
  const seekGuardUntil = useRef(0)

  // Zoom con pellizco: escala el video para recortar las bandas negras.
  // Sin reanimated en este proyecto — se arma con Animated (RN) clásico.
  const baseZoom = useRef(new Animated.Value(1)).current
  const pinchZoom = useRef(new Animated.Value(1)).current
  const zoomScale = useRef(Animated.multiply(baseZoom, pinchZoom)).current
  const currentZoomRef = useRef(1)
  const onPinchGestureEvent = useRef(
    Animated.event([{ nativeEvent: { scale: pinchZoom } }], { useNativeDriver: true })
  ).current
  function onPinchStateChange(event: any) {
    if (event.nativeEvent.oldState === GHState.ACTIVE) {
      const next = Math.max(1, Math.min(3, currentZoomRef.current * event.nativeEvent.scale))
      currentZoomRef.current = next
      baseZoom.setValue(next)
      pinchZoom.setValue(1)
    }
  }

  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([])
  const [textTracks, setTextTracks] = useState<TrackInfo[]>([])
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(-1)
  const [selectedTextTrack, setSelectedTextTrack] = useState(-1)
  const [trackPicker, setTrackPicker] = useState<'audio' | 'text' | null>(null)

  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3500)
  }

  useEffect(() => {
    scheduleHide()
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [])

  // VLCKit no tiene un fullscreen nativo propio (a diferencia de AVPlayerViewController,
  // que rota solo) — forzamos horizontal mientras este player está montado.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) }
  }, [])

  // Red de seguridad: si por lo que sea el evento nativo onLoad/onBuffer nunca
  // llega a JS, no dejar el spinner tapando el video para siempre — a los 6s
  // lo sacamos igual. No condicionamos a ningún otro evento porque si esos
  // tampoco llegan, esa condición nunca se cumpliría.
  useEffect(() => {
    const t = setTimeout(() => setBuffering(false), 6000)
    return () => clearTimeout(t)
  }, [])

  function toggleControls() {
    setControlsVisible((v) => {
      const next = !v
      if (next) scheduleHide()
      return next
    })
  }

  function handleLoad(data: OnLoadData) {
    setBuffering(false) // red de seguridad: onVideoLoad siempre llega al arrancar, aunque se pierda algún evento de buffer
    setDuration(data.duration)
    setAudioTracks(data.audioTracks.map((t) => ({ id: t.id, label: t.title || `Pista ${t.id}` })))
    setTextTracks(data.textTracks.map((t) => ({ id: t.id, label: t.title || `Subtítulo ${t.id}` })))
    const selAudio = data.audioTracks.find((t) => t.selected)
    const selText = data.textTracks.find((t) => t.selected)
    setSelectedAudioTrack(selAudio ? selAudio.id : -1)
    setSelectedTextTrack(selText ? selText.id : -1)
    if (!startedRef.current) {
      startedRef.current = true
      if (startAt > 5) {
        vlcRef.current?.seek(startAt)
        lastSeekTarget.current = startAt
        seekGuardUntil.current = Date.now() + 5000
      }
    }
  }

  function handleProgress(data: OnProgressData) {
    if (seeking.current) return

    // Después de un jumpForward/jumpBackward nativo, VLC a veces reporta un
    // par de progress events con el tiempo "confundido" (cerca de 0) aunque
    // el video YA esté reproduciendo desde el punto correcto — confirmado
    // viendo el contenido real del video en un screen recording: la imagen
    // seguía en el punto saltado mientras el contador ya decía otra cosa.
    // Filtramos esos reportes implausibles hasta ver uno que tenga sentido.
    if (lastSeekTarget.current != null) {
      if (Date.now() < seekGuardUntil.current && data.currentTime < lastSeekTarget.current - 8) {
        return
      }
      lastSeekTarget.current = null
    }

    progressRef.current = { time: data.currentTime, duration: data.seekableDuration }
    setPosition(data.currentTime)
    if (data.seekableDuration > 0) setDuration(data.seekableDuration)
    const now = Date.now()
    if (data.seekableDuration > 0 && data.currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...meta, position: data.currentTime, duration: data.seekableDuration })
    }
  }

  function handleError(data: OnVideoErrorData) {
    onError(data.error.errorString || 'Error de reproducción')
  }

  function handleBuffer(data: OnBufferData) {
    setBuffering(data.isBuffering)
  }

  // Al desmontar → guarda el progreso final
  useEffect(() => {
    return () => {
      const { time, duration: d } = progressRef.current
      if (d > 0) saveProgress({ ...meta, position: time, duration: d })
      if (seekGraceTimer.current) clearTimeout(seekGraceTimer.current)
    }
  }, [])

  function seekTo(time: number) {
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, time) : time)
    if (!vlcRef.current) return
    vlcRef.current.seek(clamped)
    progressRef.current = { ...progressRef.current, time: clamped }
    setPosition(clamped)
    lastSeekTarget.current = clamped
    seekGuardUntil.current = Date.now() + 5000
    // El seek nativo no es instantáneo — si soltamos seeking.current acá mismo,
    // un onProgress "viejo" (todavía de la posición anterior) que llegue antes
    // de que el salto termine pisa la posición recién puesta y la barra "no
    // hace nada" a los ojos del usuario. Lo soltamos un rato después.
    if (seekGraceTimer.current) clearTimeout(seekGraceTimer.current)
    seekGraceTimer.current = setTimeout(() => { seeking.current = false }, 700)
  }

  function skipBy(seconds: number) {
    seeking.current = true
    seekTo(position + seconds)
  }

  const remaining = Math.max(0, duration - position)
  const showPill = hasNext && duration > 0 && remaining > 1 && remaining <= NEXT_PILL_S

  return (
    <View style={styles.fill}>
      {/* El pinch-to-zoom envuelve SOLO el video — si envuelve toda la
          pantalla (controles incluidos), el gesture handler intercepta los
          toques de un dedo antes de que lleguen a los botones (confirmado
          con logs: el comando de seek nativo nunca se llegaba a disparar). */}
      <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchStateChange}>
        <View style={[styles.fill, styles.vlcZoomClip]}>
          <Animated.View style={[styles.fill, { transform: [{ scale: zoomScale }] }]}>
            <VideoVLC
              ref={vlcRef}
              style={styles.fill}
              initialSource={{ uri, headers: referer ? { Referer: referer } : undefined, textTracks: sideloadTextTracks }}
              paused={paused}
              resizeMode="none"
              progressUpdateInterval={500}
              selectedAudioTrack={selectedAudioTrack}
              selectedTextTrack={selectedTextTrack}
              onLoad={handleLoad}
              onProgress={handleProgress}
              onBuffer={handleBuffer}
              onError={handleError}
              onEnd={onEnded}
            />
          </Animated.View>
        </View>
      </PinchGestureHandler>

      <Pressable style={StyleSheet.absoluteFillObject} onPress={toggleControls} />

      {buffering && (
        <View style={[StyleSheet.absoluteFillObject, styles.vlcBufferCenter]} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}

      {controlsVisible && (
        <View style={StyleSheet.absoluteFillObject}>
          <View style={styles.vlcScrim} pointerEvents="none" />

          {/* Barra superior: cerrar + pistas */}
          <View style={[styles.vlcTopBar, { top: insets.top + 8 }]}>
            <Touchable scaleTo={0.9} haptic="light" style={styles.vlcIconBtn} onPress={() => onClose(duration > 0 ? position / duration : 0)}>
              <SymbolView name="xmark" tintColor="#fff" style={styles.vlcIcon} />
            </Touchable>
            {!buffering && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Touchable scaleTo={0.9} haptic="light" style={styles.vlcIconBtn} onPress={() => setTrackPicker('audio')}>
                  <SymbolView name="waveform" tintColor="#fff" style={styles.vlcIcon} />
                </Touchable>
                <Touchable scaleTo={0.9} haptic="light" style={styles.vlcIconBtn} onPress={() => setTrackPicker('text')}>
                  <SymbolView name="captions.bubble" tintColor="#fff" style={styles.vlcIcon} />
                </Touchable>
              </View>
            )}
          </View>

          {/* Play/pause + retroceder/adelantar 10s */}
          <View style={[styles.vlcCenterControls, { flexDirection: 'row', gap: 36 }]} pointerEvents="box-none">
            <Touchable scaleTo={0.9} haptic="light" style={styles.vlcSkipBtn} onPress={() => skipBy(-10)}>
              <SymbolView name="gobackward.10" tintColor="#fff" style={styles.vlcSkipIcon} />
            </Touchable>
            <Touchable scaleTo={0.9} haptic="light" style={styles.vlcPlayBtn} onPress={() => setPaused((p) => !p)}>
              <SymbolView name={paused ? 'play.fill' : 'pause.fill'} tintColor="#fff" style={styles.vlcPlayIcon} />
            </Touchable>
            <Touchable scaleTo={0.9} haptic="light" style={styles.vlcSkipBtn} onPress={() => skipBy(10)}>
              <SymbolView name="goforward.10" tintColor="#fff" style={styles.vlcSkipIcon} />
            </Touchable>
          </View>

          {/* Barra inferior: scrubber + tiempos */}
          <View style={[styles.vlcBottomBar, { bottom: insets.bottom + 12 }]}>
            <Text style={styles.vlcTime}>{fmtTime(position)}</Text>
            <Slider
              style={styles.vlcSlider}
              value={position}
              minimumValue={0}
              maximumValue={duration > 0 ? duration : 1}
              minimumTrackTintColor="#fff"
              maximumTrackTintColor="rgba(255,255,255,0.3)"
              thumbTintColor="#fff"
              onSlidingStart={() => { seeking.current = true }}
              onSlidingComplete={(v) => { seekTo(v) }}
            />
            <Text style={styles.vlcTime}>{fmtTime(duration)}</Text>
          </View>
        </View>
      )}

      {showPill && (
        <Touchable
          scaleTo={0.95}
          haptic="medium"
          style={[styles.nextPill, { bottom: insets.bottom + 80, right: insets.right + 24 }]}
          onPress={onPlayNext}
        >
          <SymbolView name="forward.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Touchable>
      )}

      {trackPicker && (
        <View style={[StyleSheet.absoluteFillObject, styles.vlcPickerOverlay]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setTrackPicker(null)} />
          <View style={styles.vlcPickerCard}>
            <Text style={styles.vlcPickerTitle}>
              {trackPicker === 'audio' ? 'Audio' : 'Subtítulos'}
            </Text>
            <ScrollView style={styles.vlcPickerList} showsVerticalScrollIndicator={false}>
              {trackPicker === 'text' && (
                <Touchable
                  scaleTo={0.98}
                  haptic="selection"
                  style={styles.vlcPickerRow}
                  onPress={() => { setSelectedTextTrack(-1); setTrackPicker(null) }}
                >
                  <Text style={[styles.vlcPickerRowText, selectedTextTrack === -1 && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                    Ninguno
                  </Text>
                  {selectedTextTrack === -1 && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                </Touchable>
              )}
              {(trackPicker === 'audio' ? audioTracks : textTracks).map((t) => {
                const selected = trackPicker === 'audio' ? selectedAudioTrack === t.id : selectedTextTrack === t.id
                return (
                  <Touchable
                    key={t.id}
                    scaleTo={0.98}
                    haptic="selection"
                    style={styles.vlcPickerRow}
                    onPress={() => {
                      if (trackPicker === 'audio') setSelectedAudioTrack(t.id)
                      else setSelectedTextTrack(t.id)
                      setTrackPicker(null)
                    }}
                  >
                    <Text style={[styles.vlcPickerRowText, selected && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                      {t.label}
                    </Text>
                    {selected && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                  </Touchable>
                )
              })}
              {trackPicker === 'audio' && audioTracks.length === 0 && (
                <Text style={styles.vlcPickerEmpty}>Esta fuente solo trae una pista de audio</Text>
              )}
              {trackPicker === 'text' && textTracks.length === 0 && (
                <Text style={styles.vlcPickerEmpty}>Esta fuente no trae subtítulos</Text>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  )
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ── Pantalla siguiente episodio (al terminar) ───────────────────────────────

function NextEpisodeScreen({
  title, season, episode, backdrop, onPlay, onBack,
}: {
  title: string; season: number; episode: number
  backdrop: string | null
  onPlay: () => void; onBack: () => void
}) {
  const [seconds, setSeconds] = useState(COUNTDOWN_S)
  const progress = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: COUNTDOWN_S * 1000,
      useNativeDriver: false,
    }).start()

    const interval = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) { clearInterval(interval); onPlay(); return 0 }
        return s - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const backdropUri = backdropUrl(backdrop, 'w780')

  return (
    <View style={styles.nextContainer}>
      {backdropUri && (
        <Image source={backdropUri} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <View style={styles.nextOverlay} />

      <View style={styles.nextContent}>
        <Text style={styles.nextLabel}>Siguiente episodio</Text>
        <Text style={styles.nextTitle}>{title}</Text>
        <Text style={styles.nextEp}>Temporada {season}  ·  Episodio {episode}</Text>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressBar,
              { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>

        <View style={styles.nextButtons}>
          <Touchable scaleTo={0.95} haptic="medium" style={styles.playNextBtn} onPress={onPlay}>
            <SymbolView name="play.fill" tintColor="#000" style={styles.playNextIcon} />
            <Text style={styles.playNextText}>Reproducir ({seconds}s)</Text>
          </Touchable>

          <Touchable scaleTo={0.95} haptic="light" style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backText}>Salir</Text>
          </Touchable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Pantalla de carga: minimalista — backdrop desenfocado + spinner chico + título.
  loadingRoot: { flex: 1, backgroundColor: '#000' },
  loadingScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40,
  },
  loadingTitle: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600', textAlign: 'center' },

  // Selector de idioma de audio: flotante, discreto, abajo del todo
  langSwitch: { position: 'absolute', left: 0, right: 0, bottom: 56, alignItems: 'center' },
  langSegmented: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, padding: 4, gap: 4,
  },
  langOption: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 9 },
  langOptionActive: { backgroundColor: '#fff' },
  langOptionText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  langOptionTextActive: { color: '#000', fontWeight: '700' },

  // Pill siguiente episodio
  nextPill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    zIndex: 30,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  nextPillIcon: { width: 15, height: 15 },
  nextPillText: { color: '#000', fontSize: 15, fontWeight: '700' },

  // Player VLCKit: controles propios
  vlcZoomClip: { overflow: 'hidden' },
  vlcBufferCenter: { alignItems: 'center', justifyContent: 'center' },
  vlcScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  vlcTopBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  vlcIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  vlcIcon: { width: 18, height: 18 },
  vlcCenterControls: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  vlcPlayBtn: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  vlcPlayIcon: { width: 26, height: 26 },
  vlcSkipBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  vlcSkipIcon: { width: 22, height: 22 },
  vlcBottomBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  vlcTime: { color: '#fff', fontSize: 12, fontWeight: '600', width: 48, textAlign: 'center' },
  vlcSlider: { flex: 1, height: 32 },
  vlcPickerOverlay: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  vlcPickerCard: {
    width: 300, maxHeight: '80%',
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    paddingTop: 14, paddingHorizontal: 8, paddingBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  vlcPickerTitle: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
    paddingHorizontal: 12,
  },
  vlcPickerList: { maxHeight: 260 },
  vlcPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12, gap: 10,
    borderRadius: 10,
  },
  vlcPickerRowText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, flexShrink: 1 },
  vlcPickerRowTextActive: { color: '#fff', fontWeight: '700' },
  vlcPickerEmpty: {
    color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center',
    paddingVertical: 20, paddingHorizontal: 12,
  },

  errIcon: { width: 48, height: 48 },
  errText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  errSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 28, lineHeight: 20 },
  errButtons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28 },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12,
  },
  retryIcon: { width: 15, height: 15 },
  retryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  errBackBtn: {
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
  },
  errBackText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Siguiente episodio (pantalla)
  nextContainer: { flex: 1, backgroundColor: '#000' },
  nextOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  nextContent: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 32,
    paddingBottom: 60,
  },
  nextLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  nextTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  nextEp: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    marginBottom: 24,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    marginBottom: 28,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  nextButtons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  playNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  playNextIcon: { width: 16, height: 16 },
  playNextText: { color: '#000', fontSize: 16, fontWeight: '700' },
  backBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  backText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
