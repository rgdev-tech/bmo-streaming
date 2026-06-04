import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Pressable, Animated,
} from 'react-native'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { SymbolView } from 'expo-symbols'
import { stream } from '@/lib/stream'
import { saveProgress, getProgress, setUpNext, type Progress } from '@/lib/library'
import { backdropUrl, tmdb } from '@/lib/tmdb'

const COUNTDOWN_S = 8
const FINISHED_RATIO = 0.9 // visto "completo" → ofrecer siguiente episodio

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string; id: string; season?: string; episode?: string
    title?: string; poster?: string; backdrop?: string; episodeTitle?: string
  }>()
  const { type, id, season, episode, title } = params
  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  const episodeN = episode ? Number(episode) : undefined

  const [ready, setReady] = useState(false)
  const [inFullscreen, setInFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [referer, setReferer] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

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

  // ¿Existe el siguiente episodio en esta temporada?
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
  }, [type, id, season, episode, retryCount])

  const masterUrl = isTv
    ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1)
    : stream.masterMovie(id)

  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    title: title ?? '',
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  function handlePlayerClose(watchedFraction: number) {
    // Si terminó un episodio y existe el siguiente → encolarlo y ofrecerlo
    if (isTv && watchedFraction >= FINISHED_RATIO && hasNextEpisode) {
      // Encola el siguiente episodio en "Seguir viendo" (listo para empezar)
      setUpNext({
        id: Number(id),
        media_type: 'tv',
        title: title ?? '',
        poster_path: params.poster ?? null,
        backdrop_path: params.backdrop ?? null,
        season: seasonN ?? 1,
        episode: nextEpisodeN,
      }).catch(() => {})
      setShowNext(true)
      setInFullscreen(false)
    } else {
      router.back()
    }
  }

  function playNextEpisode() {
    router.replace({
      pathname: '/player',
      params: {
        type: 'tv',
        id,
        season: String(seasonN ?? 1),
        episode: String(nextEpisodeN),
        title,
        poster: params.poster ?? '',
        backdrop: params.backdrop ?? '',
      },
    } as never)
  }

  // ── Siguiente episodio ──
  if (showNext) {
    return (
      <NextEpisodeScreen
        title={title ?? ''}
        season={seasonN ?? 1}
        episode={nextEpisodeN}
        backdrop={params.backdrop ?? null}
        onPlay={playNextEpisode}
        onBack={() => router.back()}
      />
    )
  }

  const showLoading = !error && !inFullscreen

  return (
    <View style={styles.container}>
      {showLoading && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>
            {ready ? 'Iniciando reproductor…' : 'Preparando stream…'}
          </Text>
          {!!title && (
            <Text style={styles.loadingSub}>
              {title}{season ? `  ·  T${season}:E${episode}` : ''}
            </Text>
          )}
        </View>
      )}

      {error && (
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
            <Pressable style={styles.errBackBtn} onPress={() => router.back()}>
              <Text style={styles.errBackText}>Volver</Text>
            </Pressable>
          </View>
        </View>
      )}

      {ready && !error && (
        <NativePlayer
          uri={masterUrl}
          referer={referer}
          startAt={startAt}
          meta={meta}
          onFullscreenEnter={() => setInFullscreen(true)}
          onClose={handlePlayerClose}
        />
      )}
    </View>
  )
}

// ── Player nativo ──────────────────────────────────────────────────────────

function NativePlayer({
  uri, referer, startAt, meta, onFullscreenEnter, onClose,
}: {
  uri: string; referer: string; startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  onFullscreenEnter: () => void
  onClose: (watchedFraction: number) => void
}) {
  const viewRef = useRef<VideoView>(null)
  const seeked = useRef(false)
  const enteredFS = useRef(false)
  const progressRef = useRef({ time: 0, duration: 0 })

  const player = useVideoPlayer(
    { uri, headers: { Referer: referer } },
    (p) => { p.timeUpdateEventInterval = 5; p.play() }
  )

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status !== 'readyToPlay') return
      if (!seeked.current && startAt > 5) {
        player.currentTime = startAt
        seeked.current = true
      }
      if (!enteredFS.current) {
        enteredFS.current = true
        setTimeout(() => viewRef.current?.enterFullscreen(), 80)
      }
    })
    return () => sub.remove()
  }, [player, startAt])

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const dur = player.duration
      progressRef.current = { time: currentTime, duration: dur }
      if (dur > 0 && currentTime > 0) {
        saveProgress({ ...meta, position: currentTime, duration: dur })
      }
    })
    return () => sub.remove()
  }, [player])

  function handleFullscreenExit() {
    const { time, duration } = progressRef.current
    const fraction = duration > 0 ? time / duration : 0
    onClose(fraction)
  }

  return (
    <VideoView
      ref={viewRef}
      player={player}
      style={styles.hiddenView}
      nativeControls
      allowsFullscreen
      allowsPictureInPicture
      contentFit="contain"
      onFullscreenEnter={onFullscreenEnter}
      onFullscreenExit={handleFullscreenExit}
    />
  )
}

// ── Pantalla siguiente episodio ────────────────────────────────────────────

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
    // Barra de cuenta regresiva
    Animated.timing(progress, {
      toValue: 0,
      duration: COUNTDOWN_S * 1000,
      useNativeDriver: false,
    }).start()

    // Cuenta regresiva numérica
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

        {/* Barra de cuenta regresiva */}
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
  hiddenView: { position: 'absolute', width: 1, height: 1, opacity: 0 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 20, textAlign: 'center' },
  loadingSub: { color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 6, textAlign: 'center' },

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

  // Siguiente episodio
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
