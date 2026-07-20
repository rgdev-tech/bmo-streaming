import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEventListener } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Ionicons } from '@expo/vector-icons'
import {
  getProgress,
  saveProgress,
  type Progress,
} from '@bmo/core/library'
import { stream, type ResolveInfo } from '@bmo/core/stream'
import { FocusButton } from '@/bmo/FocusButton'
import { colors, heroTitle, safe } from '@/bmo/theme'

const SAVE_EVERY_MS = 5000
const SEEK_STEP = 10 // segundos por pulsación de la cruceta
const CONTROLS_TIMEOUT = 4000 // se ocultan solos tras este tiempo sin tocar nada

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
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

  // Datos para persistir progreso, idénticos a los que guarda apps/client, para
  // que "Seguir viendo" y el punto de retomar sean compartidos entre teléfono
  // y TV — las claves de almacenamiento son las mismas.
  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    title: params.title ?? '',
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  // ── Resolución de la fuente ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const pos = await getProgress(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN)
      if (cancelled) return
      setStartAt(pos)

      const res = isTv
        ? await stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1)
        : await stream.resolveMovie(id)
      if (cancelled) return
      setInfo(res)
    }

    resolve().catch((e) => !cancelled && setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [id, isTv, seasonN, episodeN])

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
        <Text style={styles.loadingText}>Buscando la mejor fuente…</Text>
      </View>
    )
  }

  return (
    <Playback
      info={info}
      startAt={startAt}
      meta={meta}
      title={params.title ?? ''}
      onExit={() => router.back()}
      onError={setError}
    />
  )
}

/**
 * Reproducción propiamente dicha, en su propio componente para montarse recién
 * cuando la fuente ya está resuelta: useVideoPlayer necesita la URI en el
 * primer render, no admite recibirla después.
 *
 * Controles de transporte por cruceta, no táctiles: OK alterna play/pausa,
 * izquierda/derecha saltan ±10 s, y cualquier tecla revela los controles, que
 * se ocultan solos tras unos segundos. Es el lenguaje que todo usuario de TV ya
 * conoce, así que no hace falta enseñarlo.
 *
 * Los controles son un HUD visual, no botones enfocables: en un reproductor de
 * TV el control es el mando, no el foco. Con botones enfocables, OK dispararía
 * a la vez el handler global y el botón bajo el foco. El HUD solo refleja el
 * estado; toda la interacción pasa por useTVEventHandler.
 */
function Playback({
  info,
  startAt,
  meta,
  title,
  onExit,
  onError,
}: {
  info: ResolveInfo
  startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  onExit: () => void
  onError: (msg: string) => void
}) {
  // Para HLS se reproduce el master proxeado por nuestro API (variantes +
  // segmentos + subtítulos); para fuentes 'file' se prueba la URL directa, que
  // en Android (ExoPlayer) soporta mkv nativo — a diferencia de iOS, que por
  // eso necesita VLC. Si el archivo no reproduce, cae al onError con retry.
  const isTv = meta.media_type === 'tv'
  const uri =
    info.type === 'hls'
      ? isTv
        ? stream.masterTv(meta.id, meta.season ?? 1, meta.episode ?? 1)
        : stream.masterMovie(meta.id)
      : info.streamUrl

  const player = useVideoPlayer(
    {
      uri,
      headers: info.referer ? { Referer: info.referer } : undefined,
      contentType: info.type === 'hls' ? 'hls' : 'auto',
    },
    (p) => {
      p.timeUpdateEventInterval = 0.5
      p.bufferOptions = { preferredForwardBufferDuration: 30 }
    }
  )

  const [playing, setPlaying] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [buffering, setBuffering] = useState(true)

  const progressRef = useRef({ time: 0, duration: 0 })
  const lastSave = useRef(0)
  const started = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT)
  }, [])

  useEffect(() => {
    revealControls()
    return () => clearTimeout(hideTimer.current)
  }, [revealControls])

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
    } else if (status === 'loading') {
      setBuffering(true)
    } else if (status === 'error') {
      onError(err?.message ?? 'Error de reproducción')
    }
  })

  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying))

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const dur = player.duration
    progressRef.current = { time: currentTime, duration: dur }
    setPosition(currentTime)
    if (dur > 0) setDuration(dur)

    const now = Date.now()
    if (dur > 0 && currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now
      // saveProgress ya alimenta "Seguir viendo": guarda la fila de progreso
      // con posición y duración, que es lo que lee ContinueRow.
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

  // Captura el mando a nivel global. La primera tecla con los controles ocultos
  // solo los revela; con los controles visibles, actúa. `select` es el OK del
  // control; las flechas ya no mueven foco porque no hay nada enfocable.
  useTVEventHandler((evt) => {
    const type = evt?.eventType
    if (!type || type === 'blur' || type === 'focus') return

    const hidden = !controlsVisible
    revealControls()
    if (hidden) return

    if (type === 'select' || type === 'playPause') togglePlay()
    else if (type === 'left' || type === 'rewind') seekBy(-SEEK_STEP)
    else if (type === 'right' || type === 'fastForward') seekBy(SEEK_STEP)
  })

  const pct = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <View style={styles.playerRoot}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />

      {buffering && (
        <View style={styles.bufferBadge} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}

      {controlsVisible && (
        <View style={styles.controls} pointerEvents="none">
          <View style={styles.topBar}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>

          {/* HUD de transporte: refleja el estado, no recibe foco. El botón
              central grande marca play/pausa; los laterales, que ±10 s están a
              izquierda/derecha del mando. */}
          <View style={styles.transport}>
            <HudIcon icon="play-back" label={`-${SEEK_STEP}s`} />
            <HudIcon icon={playing ? 'pause' : 'play'} big />
            <HudIcon icon="play-forward" label={`+${SEEK_STEP}s`} />
          </View>

          <View style={styles.bottomBar}>
            <View style={styles.timeline}>
              <View style={[styles.timelineFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <View style={styles.times}>
              <Text style={styles.time}>{fmt(position)}</Text>
              <Text style={styles.hintText}>Atrás para salir</Text>
              <Text style={styles.time}>{fmt(duration)}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function HudIcon({
  icon,
  label,
  big,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label?: string
  big?: boolean
}) {
  const size = big ? 74 : 56
  return (
    <View style={styles.hudItem}>
      <View style={[styles.circle, big && styles.circleBig, { width: size, height: size, borderRadius: size / 2 }]}>
        <Ionicons name={icon} size={big ? 34 : 24} color={colors.text} />
      </View>
      {!!label && <Text style={styles.transportLabel}>{label}</Text>}
    </View>
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
    // Oscurece el video para que los controles se lean sobre cualquier escena.
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  title: { ...heroTitle, fontSize: 30, flex: 1 },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  hudItem: { alignItems: 'center', gap: 6 },
  circle: {
    backgroundColor: 'rgba(20,20,20,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // El play/pausa central va más marcado: es la acción por defecto del OK.
  circleBig: { backgroundColor: 'rgba(255,255,255,0.16)' },
  transportLabel: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  hintText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },

  bottomBar: { gap: 12 },
  timeline: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  timelineFill: { height: '100%', backgroundColor: colors.text },
  times: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 14, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
})
