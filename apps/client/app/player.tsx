import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Pressable, Animated,
} from 'react-native'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEventListener } from 'expo'
import { SymbolView } from 'expo-symbols'
import Slider from '@react-native-community/slider'
import * as ScreenOrientation from 'expo-screen-orientation'
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream } from '@/lib/stream'
import { saveProgress, getProgress, setUpNext, type Progress } from '@/lib/library'
import { backdropUrl, tmdb } from '@/lib/tmdb'

const COUNTDOWN_S = 8
const FINISHED_RATIO = 0.9 // visto "completo" → ofrecer siguiente episodio
const NEXT_PILL_S = 50      // segundos finales en que aparece el pill "Siguiente"
const CONTROLS_HIDE_MS = 3500
const SAVE_EVERY_MS = 5000  // throttle de guardado de progreso (evita I/O por segundo)

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string; id: string; season?: string; episode?: string
    title?: string; poster?: string; backdrop?: string; episodeTitle?: string
  }>()
  const { type, id, season, episode, title } = params
  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  // El episodio es estado interno → cambiar de episodio NO renavega (transición fluida)
  const [episodeN, setEpisodeN] = useState(episode ? Number(episode) : undefined)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [referer, setReferer] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [exiting, setExiting] = useState(false)  // cubre con negro al salir
  const [entering, setEntering] = useState(true) // cubre con negro al entrar

  // Forzar horizontal mientras se reproduce.
  // Al entrar mostramos negro hasta completar la rotación (sin salto visible).
  useEffect(() => {
    let mounted = true
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      .catch(() => {})
      .finally(() => { if (mounted) setEntering(false) })
    return () => {
      mounted = false
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    }
  }, [])

  // Salida limpia: cubre con negro, rota a vertical y LUEGO cierra
  // (evita ver el contenido rotando durante la animación de cierre)
  async function exitToBack() {
    setExiting(true)
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    } catch {}
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
    setRetryCount((c) => c + 1)
  }

  useEffect(() => {
    let cancelled = false
    const resolveP = isTv
      ? stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1)
      : stream.resolveMovie(id)
    Promise.all([
      resolveP,
      getProgress(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN),
    ])
      .then(([info, pos]) => {
        if (cancelled) return
        setReferer(info.referer)
        setStartAt(pos)
        setReady(true)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => { cancelled = true }
  }, [type, id, seasonN, episodeN, retryCount])

  const masterUrl = isTv
    ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1)
    : stream.masterMovie(id)

  // Título mostrado: quita el sufijo "· T_:E_" si vino y lo reconstruye
  // con el episodio actual (para que se actualice al pasar al siguiente)
  const baseTitle = (title ?? '').replace(/\s*·\s*T\d+:E\d+\s*$/, '')
  const displayTitle = isTv
    ? `${baseTitle} · T${seasonN ?? 1}:E${episodeN ?? 1}`
    : baseTitle

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
      setShowNext(true)
    } else {
      exitToBack()
    }
  }

  // Cambia de episodio SIN renavegar: resetea y deja que el effect re-resuelva
  function playNextEpisode() {
    setShowNext(false)
    setReady(false)
    setStartAt(0)
    setEpisodeN(nextEpisodeN)
  }

  // Mientras entra o sale: fondo negro que cubre la rotación (sin salto)
  if (entering || exiting) {
    return <View style={styles.container} />
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
          <Text style={styles.errSub}>
            No encontramos una fuente disponible. Puede ser contenido muy
            reciente o un fallo temporal — intenta de nuevo.
          </Text>
          <View style={styles.errButtons}>
            <Pressable style={styles.retry} onPress={retry}>
              <SymbolView name="arrow.clockwise" tintColor="#000" style={styles.retryIcon} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
            <Pressable style={styles.errBackBtn} onPress={exitToBack}>
              <Text style={styles.errBackText}>Volver</Text>
            </Pressable>
          </View>
        </View>
      ) : ready ? (
        <NativePlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}`}
          uri={masterUrl}
          referer={referer}
          startAt={startAt}
          meta={meta}
          title={displayTitle}
          hasNext={hasNextEpisode}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onDismiss={exitToBack}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Preparando stream…</Text>
          {!!title && (
            <Text style={styles.loadingSub}>
              {title}{season ? `  ·  T${season}:E${episode}` : ''}
            </Text>
          )}
        </View>
      )}
    </GestureHandlerRootView>
  )
}

// ── Player a pantalla completa con controles propios ────────────────────────

function NativePlayer({
  uri, referer, startAt, meta, title, hasNext, onClose, onEnded, onPlayNext, onDismiss,
}: {
  uri: string; referer: string; startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  hasNext: boolean
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onDismiss: () => void
}) {
  const insets = useSafeAreaInsets()
  const seeked = useRef(false)
  const lastSave = useRef(0)
  const progressRef = useRef({ time: 0, duration: 0 })

  const [playing, setPlaying] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  // 'contain' = ajustar (barras negras) · 'cover' = llenar (recorta), como YouTube
  const [fit, setFit] = useState<'contain' | 'cover'>('contain')
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // translateY para el swipe-to-dismiss
  const dragY = useRef(new Animated.Value(0)).current

  // Gesto de pellizcar: separar dedos → llenar, juntar → ajustar
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      if (e.scale > 1.15) setFit('cover')
      else if (e.scale < 0.85) setFit('contain')
    })

  // Gesto de arrastrar hacia abajo para cerrar (como YouTube)
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY(20)   // solo activa con arrastre vertical claro
    .failOffsetX([-25, 25]) // no robar gestos horizontales (slider)
    .onUpdate((e) => {
      if (e.translationY > 0) dragY.setValue(e.translationY)
    })
    .onEnd((e) => {
      if (e.translationY > 130 || e.velocityY > 800) {
        onDismiss()
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
      }
    })

  const gestures = Gesture.Simultaneous(pinch, pan)

  const player = useVideoPlayer(
    { uri, headers: { Referer: referer }, contentType: 'hls' },
    (p) => {
      p.timeUpdateEventInterval = 0.5
      // Buffer generoso para HD estable (waitsToMinimizeStalling por defecto
      // = true, necesario para que el HLS arranque solo de forma fiable)
      p.bufferOptions = {
        preferredForwardBufferDuration: 30,
      }
    }
  )

  // Arrancar la reproducción cuando el stream está realmente listo
  const started = useRef(false)
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && !started.current) {
      started.current = true
      if (startAt > 5) {
        player.currentTime = startAt
        seeked.current = true
      }
      player.play()
    }
  })

  // Auto-ocultar controles
  function scheduleHide() {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS)
  }
  function showControls() {
    setControlsVisible(true)
    scheduleHide()
  }
  useEffect(() => {
    scheduleHide()
    return () => clearTimeout(hideTimer.current)
  }, [])

  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying))

  // Progreso (slider en tiempo real, guardado throttleado)
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const dur = player.duration
    progressRef.current = { time: currentTime, duration: dur }
    if (!scrubbing) setPosition(currentTime)
    if (dur > 0) setDuration(dur)
    const now = Date.now()
    if (dur > 0 && currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      saveProgress({ ...meta, position: currentTime, duration: dur })
    }
  })

  useEventListener(player, 'playToEnd', () => onEnded())

  function close() {
    const { time, duration: d } = progressRef.current
    onClose(d > 0 ? time / d : 0)
  }
  function togglePlay() {
    playing ? player.pause() : player.play()
    showControls()
  }
  function seekBy(s: number) {
    player.seekBy(s)
    showControls()
  }

  const remaining = duration - position
  const showPill =
    hasNext && duration > 0 && remaining > 1 && remaining <= NEXT_PILL_S

  return (
    <Animated.View style={[styles.fill, { transform: [{ translateY: dragY }] }]}>
      {/* Pinch (ajustar/llenar) + swipe-down (cerrar), como YouTube */}
      <GestureDetector gesture={gestures}>
        <View style={styles.fill}>
          <VideoView
            player={player}
            style={styles.fill}
            nativeControls={false}
            allowsPictureInPicture
            contentFit={fit}
          />
          {/* Capa de toque: muestra/oculta controles */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => (controlsVisible ? setControlsVisible(false) : showControls())}
          />
        </View>
      </GestureDetector>

      {controlsVisible && (
        <View style={styles.controlsLayer} pointerEvents="box-none">
          {/* Oscurecedor para legibilidad */}
          <View style={styles.scrim} pointerEvents="none" />

          {/* Top: cerrar + título */}
          <View style={[styles.topBar, { top: insets.top + 6, left: insets.left + 12, right: insets.right + 12 }]}>
            <Pressable style={styles.iconBtn} onPress={close} hitSlop={12}>
              <SymbolView name="xmark" tintColor="#fff" style={styles.closeIcon} />
            </Pressable>
            <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
            <View style={styles.iconBtn} />
          </View>

          {/* Centro: -10 / play-pause / +10 */}
          <View style={styles.centerRow} pointerEvents="box-none">
            <Pressable onPress={() => seekBy(-10)} hitSlop={12}>
              <SymbolView name="gobackward.10" tintColor="#fff" style={styles.seekIcon} />
            </Pressable>
            <Pressable onPress={togglePlay} hitSlop={12} style={styles.playPause}>
              <SymbolView
                name={playing ? 'pause.fill' : 'play.fill'}
                tintColor="#fff"
                style={styles.playPauseIcon}
              />
            </Pressable>
            <Pressable onPress={() => seekBy(10)} hitSlop={12}>
              <SymbolView name="goforward.10" tintColor="#fff" style={styles.seekIcon} />
            </Pressable>
          </View>

          {/* Bottom: scrubber */}
          <View style={[styles.bottomBar, { bottom: insets.bottom + 10, left: insets.left + 16, right: insets.right + 16 }]}>
            <Text style={styles.time}>{fmtTime(position)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={duration || 1}
              value={position}
              minimumTrackTintColor="#fff"
              maximumTrackTintColor="rgba(255,255,255,0.3)"
              thumbTintColor="#fff"
              onSlidingStart={() => { setScrubbing(true); clearTimeout(hideTimer.current) }}
              onValueChange={(v) => setPosition(v)}
              onSlidingComplete={(v) => {
                player.currentTime = v
                setScrubbing(false)
                scheduleHide()
              }}
            />
            <Text style={styles.time}>-{fmtTime(remaining)}</Text>
          </View>
        </View>
      )}

      {/* Pill "Siguiente episodio" — siempre visible en los últimos segundos */}
      {showPill && (
        <Pressable
          style={[styles.nextPill, { bottom: insets.bottom + (controlsVisible ? 64 : 28), right: insets.right + 20 }]}
          onPress={onPlayNext}
        >
          <SymbolView name="forward.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Pressable>
      )}
    </Animated.View>
  )
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
          <Pressable style={styles.playNextBtn} onPress={onPlay}>
            <SymbolView name="play.fill" tintColor="#000" style={styles.playNextIcon} />
            <Text style={styles.playNextText}>Reproducir ({seconds}s)</Text>
          </Pressable>

          <Pressable style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backText}>Salir</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 20, textAlign: 'center' },
  loadingSub: { color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 6, textAlign: 'center' },

  // Controles custom
  controlsLayer: { ...StyleSheet.absoluteFillObject },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  topBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { width: 17, height: 17 },
  topTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  centerRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  seekIcon: { width: 38, height: 38 },
  playPause: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseIcon: { width: 44, height: 44 },
  bottomBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slider: { flex: 1, height: 40 },
  time: { color: '#fff', fontSize: 13, fontWeight: '600', minWidth: 46, textAlign: 'center' },

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
