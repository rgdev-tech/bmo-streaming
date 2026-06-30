import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Pressable, Animated,
} from 'react-native'
import { Image } from 'expo-image'
import Video, { type VideoRef, TextTrackType, type TextTracks, type ISO639_1 } from 'react-native-video'
import { SymbolView } from 'expo-symbols'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream, getAudioLang, setAudioLang as persistAudioLang, type AudioLang, type Subtitle } from '@/lib/stream'
import { saveProgress, getProgress, setUpNext, type Progress } from '@/lib/library'
import { backdropUrl, tmdb } from '@/lib/tmdb'
import { getLocalPath, smartDownloadNext } from '@/lib/download'

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
  const [showNext, setShowNext] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [subtitles, setSubtitles] = useState<Subtitle[]>([])

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
        setSubtitles([])
        setReady(true)
        return
      }

      // 2. Resolución normal via API (con el idioma de audio preferido)
      const resolveP = isTv
        ? stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1, audioLang)
        : stream.resolveMovie(id, audioLang)

      const info = await resolveP
      if (cancelled) return
      setStreamUrl(info.streamUrl)
      setStreamType(info.type ?? 'hls')
      setReferer(info.referer)
      setStartAt(pos)
      setSubtitles(info.subtitles ?? [])
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

  // URI final según la fuente:
  //  - local: m3u8 descargado
  //  - file (mp4): URL directa del CDN → AVPlayer la reproduce nativo (range/seek)
  //  - hls: master proxeado por nuestro servidor (variantes + segmentos + subs)
  const masterUrl = localUri
    ?? (streamType === 'file' && streamUrl
      ? streamUrl
      : (isTv
        ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1, audioLang)
        : stream.masterMovie(id, audioLang)))

  // contentType: hls para playlists; para mp4 dejamos que AVPlayer auto-detecte
  const contentType: 'hls' | 'auto' = (localUri || streamType !== 'file') ? 'hls' : 'auto'

  // Para mp4 (file) inyectamos textTracks sideloaded con las pistas Wyzie (VTT).
  // Para HLS los subtítulos ya vienen en el manifest (#EXT-X-MEDIA:TYPE=SUBTITLES).
  const textTracksForPlayer: TextTracks = (contentType === 'auto' && subtitles.length > 0)
    ? subtitles.map((s) => ({
        title: s.label,
        language: s.lang as ISO639_1,
        type: TextTrackType.VTT,
        uri: stream.subVtt(isTv ? 'tv' : 'movie', id, s.i, seasonN, episodeN, audioLang),
      }))
    : []

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
            <Pressable style={styles.retry} onPress={retry}>
              <SymbolView name="arrow.clockwise" tintColor="#000" style={styles.retryIcon} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
            <Pressable style={styles.errBackBtn} onPress={exitToBack}>
              <Text style={styles.errBackText}>Volver</Text>
            </Pressable>
          </View>
        </View>
      ) : ready && masterUrl ? (
        <NativePlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${contentType}`}
          uri={masterUrl}
          contentType={contentType}
          referer={referer}
          textTracks={textTracksForPlayer}
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
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Preparando stream…</Text>
          {!!title && (
            <Text style={styles.loadingSub}>
              {title}{season ? `  ·  T${season}:E${episode}` : ''}
            </Text>
          )}

          {/* Selector de idioma de audio / versión */}
          {!localUri && (
            <View style={styles.langSwitch}>
              <Text style={styles.langSwitchLabel}>Audio</Text>
              <View style={styles.langSegmented}>
                {(['original', 'latino'] as const).map((opt) => (
                  <Pressable
                    key={opt}
                    style={[styles.langOption, audioLang === opt && styles.langOptionActive]}
                    onPress={() => changeAudioLang(opt)}
                  >
                    <Text style={[styles.langOptionText, audioLang === opt && styles.langOptionTextActive]}>
                      {opt === 'original' ? 'Original' : 'Español Latino'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </GestureHandlerRootView>
  )
}

// ── Player a pantalla completa con controles propios ────────────────────────

function NativePlayer({
  uri, contentType, referer, startAt, meta, hasNext, onClose, onEnded, onPlayNext, onError, textTracks,
}: {
  uri: string; contentType: 'hls' | 'auto'; referer: string; startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
  textTracks?: TextTracks
}) {
  const insets = useSafeAreaInsets()
  const videoRef = useRef<VideoRef>(null)
  const lastSave = useRef(0)
  const progressRef = useRef({ time: 0, duration: 0 })
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [inFullscreen, setInFullscreen] = useState(false)
  const inFullscreenRef = useRef(false)
  const seeked = useRef(false)
  const hasError = useRef(false)
  // Error capturado durante fullscreen — se propaga al cerrar, no inmediatamente,
  // para evitar que el desmontaje del componente y el dismiss nativo colisionen.
  const pendingError = useRef<string | null>(null)

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
      <Video
        ref={videoRef}
        source={{
          uri,
          headers: referer ? { Referer: referer } : undefined,
          ...(textTracks && textTracks.length > 0 ? { textTracks } : {}),
        }}
        controls
        paused={false}
        progressUpdateInterval={500}
        resizeMode="contain"
        onLoad={({ duration: dur }) => {
          if (dur > 0) setDuration(dur)
          if (startAt > 5 && !seeked.current) {
            seeked.current = true
            videoRef.current?.seek(startAt)
          }
          setTimeout(() => videoRef.current?.presentFullscreenPlayer(), 100)
        }}
        onProgress={({ currentTime, seekableDuration }) => {
          progressRef.current = { time: currentTime, duration: seekableDuration }
          setPosition(currentTime)
          if (seekableDuration > 0) setDuration(seekableDuration)
          const now = Date.now()
          if (seekableDuration > 0 && currentTime > 0 && now - lastSave.current > SAVE_EVERY_MS) {
            lastSave.current = now
            saveProgress({ ...meta, position: currentTime, duration: seekableDuration })
          }
        }}
        onEnd={() => { if (!hasError.current) onEnded() }}
        onFullscreenPlayerDidPresent={() => {
          setInFullscreen(true)
          inFullscreenRef.current = true
        }}
        onFullscreenPlayerWillDismiss={() => {
          setInFullscreen(false)
          inFullscreenRef.current = false
          const { time, duration: d } = progressRef.current
          if (pendingError.current) {
            // Había un error pendiente — propagar ahora que el fullscreen ya cerró
            const msg = pendingError.current
            pendingError.current = null
            onError(msg)
          } else {
            onClose(d > 0 ? time / d : 0)
          }
        }}
        onError={(e) => {
          const msg = e.error?.error
            ?? e.error?.localizedDescription
            ?? e.error?.errorString
            ?? 'Player error'
          console.warn('[player] onError:', JSON.stringify(e))
          hasError.current = true
          if (inFullscreenRef.current) {
            // En fullscreen: guardar el error y pedir cierre para que el dismiss
            // lo propague de forma segura (evita colisión JS/nativo al desmontar)
            pendingError.current = msg
            videoRef.current?.dismissFullscreenPlayer()
          } else {
            onError(msg)
          }
        }}
        style={styles.fill}
      />

      {/* Pill "Siguiente episodio" — solo visible fuera de fullscreen */}
      {showPill && !inFullscreen && (
        <Pressable
          style={[styles.nextPill, { bottom: insets.bottom + 80, right: insets.right + 24 }]}
          onPress={onPlayNext}
        >
          <SymbolView name="forward.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Pressable>
      )}
    </View>
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

  // Selector de idioma de audio (pantalla de carga)
  langSwitch: { alignItems: 'center', marginTop: 32 },
  langSwitchLabel: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  langSegmented: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, padding: 4, gap: 4,
  },
  langOption: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 9 },
  langOptionActive: { backgroundColor: '#fff' },
  langOptionText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
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
