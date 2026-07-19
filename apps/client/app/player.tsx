import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Animated, Pressable, ScrollView, useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native'
import { Image } from 'expo-image'
import * as FileSystem from 'expo-file-system'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEventListener } from 'expo'
import { SymbolView } from 'expo-symbols'
import Slider from '@react-native-community/slider'
import * as ScreenOrientation from 'expo-screen-orientation'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream, getAudioLang, setAudioLang as persistAudioLang, type AudioLang, type Subtitle, type SourceOption } from '@/lib/stream'
import {
  getSubtitleStyle, setSubtitleStyle, DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONT_SIZE, SUBTITLE_COLOR_CSS,
  type SubtitleStyle as SubtitleStyleT,
} from '@/lib/subtitleStyle'
import { decodeSrtBytes, parseSrt, findActiveCue, type SrtCue } from '@/lib/srt'
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

// Descarga el subtítulo en español a disco (caché), lo parsea y devuelve las
// cues listas para renderizar como overlay en JS — no va a VLCKit: el estilo
// (tamaño/color/fondo) tiene que poder cambiar al instante, y las opciones de
// subtítulo de libvlc son de instancia (recrear el player entero, con re-buffer
// de red incluido, cada vez que el usuario toca "Grande"). Se baja DESDE EL
// TELÉFONO (no el servidor, cuya IP de datacenter bloquea Cloudflare en
// dl.opensubtitles.org). Corre en paralelo DESPUÉS de montar el player (no
// bloquea el arranque del video) — el overlay JS solo recoge las cues cuando
// llegan, sin ninguna carrera con el montaje nativo.
async function downloadSpanishSubs(
  subs: Subtitle[], type: string, id: string, season?: number, episode?: number,
): Promise<SrtCue[]> {
  const esSubs = subs.filter((s) => s.lang === 'es')
  if (!esSubs.length) { console.log('[subs] sin candidatos en español'); return [] }
  const dir = `${FileSystem.cacheDirectory}subs/`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  console.log(`[subs] ${esSubs.length} candidato(s) español para ${type}/${id} T${season}:E${episode}`)
  for (const s of esSubs) {
    const localPath = `${dir}${type}-${id}-${season ?? 0}-${episode ?? 0}-${s.i}.srt`
    // No confiar solo en "existe": una descarga vieja/interrumpida puede haber
    // dejado un archivo chico/corrupto, y quedaría cacheado para siempre.
    const cached = await FileSystem.getInfoAsync(localPath, { size: true })
    if (cached.exists && cached.size > 200) {
      console.log(`[subs] caché (${cached.size}b): ${localPath}`)
      const cues = await readAndParseSrt(localPath)
      if (cues.length) return cues
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    } else if (cached.exists) {
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    }
    for (const url of [s.url, ...s.altUrls]) {
      try {
        const dl = await FileSystem.downloadAsync(url, localPath)
        console.log(`[subs] GET ${url} → ${dl.status}`)
        if (dl.status !== 200) continue
        // Un .srt real nunca es text/html; una página de bloqueo de Cloudflare sí.
        const ct = Object.entries(dl.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
        if (/text\/html/i.test(ct)) {
          console.log(`[subs] content-type=${ct} → bloqueo, descarto`)
          await FileSystem.deleteAsync(localPath, { idempotent: true })
          continue
        }
        const cues = await readAndParseSrt(localPath)
        console.log(`[subs] OK: ${cues.length} cues parseadas de ${localPath}`)
        if (cues.length) return cues
        await FileSystem.deleteAsync(localPath, { idempotent: true })
      } catch (e) {
        console.log(`[subs] excepción ${url}: ${String(e)}`)
      }
    }
  }
  console.log('[subs] ningún candidato dio cues válidas')
  return []
}

// Lee el archivo como base64 (a salvo de encoding: no interpreta bytes) y
// decodifica/parsea. Un .srt con 0 cues parseadas normalmente es contenido
// basura (encoding roto, formato inesperado) — se trata como fallo.
async function readAndParseSrt(localPath: string): Promise<SrtCue[]> {
  const b64 = await FileSystem.readAsStringAsync(localPath, { encoding: FileSystem.EncodingType.Base64 })
  const binary = atob(b64)
  const text = decodeSrtBytes(binary)
  return parseSrt(text)
}

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
  const [hasLatinoAlternative, setHasLatinoAlternative] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Idioma de audio: 'original' (subtitulado) | 'latino' (doblaje). Persistido.
  // Default 'latino' — coincide con el default de getAudioLang() en lib/stream.ts,
  // así no dispara un resolve de más con 'original' antes de que cargue la
  // preferencia real desde AsyncStorage.
  const [audioLang, setAudioLangState] = useState<AudioLang>('latino')
  useEffect(() => { getAudioLang().then(setAudioLangState) }, [])

  // La pantalla entera (LoadingScreen incluida) está forzada a landscape desde
  // el mount (ver el useEffect de abajo) — así que TODA salida, sea cual sea
  // la fuente, tiene que revertir a portrait antes de navegar. Si dejáramos
  // que el cleanup del useEffect de desmontaje lo haga solo, el revert se
  // dispara en un momento impredecible respecto a la transición de salida del
  // modal, y se ve la pantalla "rebotar" horizontal→vertical→horizontal en
  // vez de un giro limpio. Relockeamos portrait ACÁ, antes de navegar — el
  // giro pasa mientras el player todavía se ve entero y la transición de
  // salida ya arranca en portrait, sin pelearse con ninguna otra rotación.
  async function exitToBack() {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
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
      setHasLatinoAlternative(info.hasLatinoAlternative ?? false)
      setStartAt(pos)
      setReady(true)

      // Pre-resuelve el siguiente episodio en segundo plano
      if (isTv) stream.prewarm('tv', id, seasonN ?? 1, (episodeN ?? 1) + 1, audioLang)

      // El subtítulo en español NO bloquea el arranque — es la única espera
      // "innecesaria" que quedaba entre resolver y ver video: se baja en
      // paralelo, mientras el player ya está montado y bufferizando, y el
      // overlay JS lo recoge apenas llega (es solo estado, sin carrera con
      // el montaje nativo). Antes esto vivía ACÁ, adelante de setReady(true).
      if (info.type === 'file') {
        downloadSpanishSubs(info.subtitles ?? [], type, id, seasonN, episodeN)
          .then((cues) => { if (!cancelled) setSrtCues(cues) })
          .catch(() => {})
      }
    }

    resolve().catch((e) => !cancelled && setError(String(e)))
    return () => { cancelled = true }
  }, [type, id, seasonN, episodeN, retryCount, audioLang])

  // Si existe descarga local, el player la usará directamente (sin pasar por API)
  const [localUri, setLocalUri] = useState<string | null>(params.localPath ?? null)
  useEffect(() => {
    getLocalPath(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN).then(setLocalUri)
  }, [id, isTv, seasonN, episodeN])

  // Una descarga puede ser de dos formas y cada una necesita un player
  // distinto: un m3u8 recompuesto a partir de segmentos (HLS → expo-video) o
  // un archivo único mkv/mp4 bajado de Real-Debrid (→ VLCKit). Antes se asumía
  // que todo lo local era HLS, así que un mkv descargado se le pasaba a
  // AVPlayer y no reproducía.
  const localIsFile = !!localUri && !localUri.endsWith('.m3u8')

  // URI final para la vía expo-video/HLS:
  //  - local: m3u8 descargado
  //  - hls: master proxeado por nuestro servidor (variantes + segmentos + subs)
  const masterUrl = (localUri && !localIsFile ? localUri : null)
    ?? (isTv
      ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1, audioLang)
      : stream.masterMovie(id, audioLang))

  // Fuentes "file" → VLCKit: soporta mkv nativo y permite sideload/selección de
  // subtítulos y pistas de audio sin re-resolver. Cubre tanto el streaming
  // directo de Real-Debrid como un archivo ya descargado.
  const isVlcSource = localIsFile || (streamType === 'file' && !localUri && !!streamUrl)
  // Para VLCKit: el archivo local manda sobre la URL remota.
  const vlcUri = localIsFile ? localUri! : streamUrl

  // Orientación a nivel de PANTALLA, no por instancia de VlcPlayer ni por tipo
  // de fuente. Se fuerza landscape UNA vez al entrar a esta pantalla (deps
  // vacías) — así la LoadingScreen (spinner + selector de audio) ya aparece
  // horizontal, en vez de esperar a que resuelva el stream para recién ahí
  // rotar. Sin gating por isVlcSource: antes solo se forzaba para VLC (el
  // NativePlayer rotaba solo, vía su propio fullscreen de Apple) — ahora que
  // el landscape arranca desde la carga, el mismo lock sirve para los dos;
  // el revert a portrait queda reservado para la salida real (exitToBack,
  // antes de navegar) y para el desmontaje de la pantalla entera (cleanup de
  // abajo). Cambiar de episodio (o de idioma de audio) desmonta y remonta el
  // player, pero como este lock no depende de isVlcSource no se re-dispara ni
  // parpadea en esa transición.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
  }, [])

  useEffect(() => {
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) }
  }, [])

  // ── Selector de calidad ──
  // Las fuentes se piden una sola vez, en segundo plano y DESPUÉS de que el
  // video ya arrancó: es información para un menú que quizá nunca se abra, y
  // no debe competir con el arranque de la reproducción.
  const [sources, setSources] = useState<SourceOption[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [pickedSource, setPickedSource] = useState<number | null>(null)

  useEffect(() => {
    if (!ready || !isVlcSource || localIsFile) return
    let cancelled = false
    setSourcesLoading(true)
    stream.sources(isTv ? 'tv' : 'movie', id, seasonN, episodeN, audioLang)
      .then((list) => { if (!cancelled) setSources(list) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSourcesLoading(false) })
    return () => { cancelled = true }
  }, [ready, isVlcSource, localIsFile, id, seasonN, episodeN, audioLang])

  // Última posición conocida, para conservarla al cambiar de fuente.
  const lastPositionRef = useRef(0)

  // Cambiar de fuente re-resuelve y remonta el player desde la posición actual.
  async function pickSource(i: number) {
    setPickedSource(i)
    setReady(false)
    try {
      const info = await stream.pickSource(isTv ? 'tv' : 'movie', id, i, seasonN, episodeN, audioLang)
      setStreamUrl(info.streamUrl)
      setStreamType(info.type ?? 'file')
      setReferer(info.referer)
      // Se retoma donde iba, no desde cero: cambiar de calidad no debería
      // costar el progreso.
      setStartAt(lastPositionRef.current)
      setReady(true)
    } catch {
      setError('No se pudo abrir esa fuente')
    }
  }

  // Subtítulo español: descargado y parseado en segundo plano por resolve()
  // (ver downloadSpanishSubs) — llega después de que el player ya arrancó.
  // Se renderiza como overlay JS, no vía VLCKit — así el estilo cambia al
  // instante (ver VlcPlayer/SubtitleOverlay más abajo).
  const [srtCues, setSrtCues] = useState<SrtCue[]>([])

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
      ) : ready && isVlcSource && vlcUri ? (
        <VlcPlayer
          // La fuente entra en la key: al cambiar de calidad hay que remontar
          // el player, no solo cambiarle la uri.
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${pickedSource ?? 'auto'}-vlc`}
          uri={vlcUri}
          // Un archivo local no necesita Referer (y pasárselo confunde a VLC).
          referer={localIsFile ? '' : referer}
          srtCues={srtCues}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          audioLang={audioLang}
          hasLatinoAlternative={hasLatinoAlternative}
          onChangeAudioLang={changeAudioLang}
          sources={sources}
          sourcesLoading={sourcesLoading}
          activeSourceIndex={pickedSource}
          // Sin fuentes alternativas no se ofrece la pestaña (descarga local).
          onPickSource={localIsFile ? undefined : pickSource}
          onPosition={(t) => { lastPositionRef.current = t }}
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
          onClose={exitToBack}
        />
      )}
    </GestureHandlerRootView>
  )
}

// Etiqueta legible de una fuente: "4K · HDR · HEVC · 12.4 GB". El nombre de
// archivo crudo va debajo como línea secundaria — sirve para distinguir dos
// opciones parecidas, pero no es lo que el usuario lee primero.
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

// ── Pantalla de carga: mínima, rápida, con selector de audio discreto ───────

function LoadingScreen({
  title, episodeLabel, backdrop, audioLang, showAudioSwitch, onChangeAudioLang, onClose,
}: {
  title: string
  episodeLabel?: string
  backdrop: string | null
  audioLang: AudioLang
  showAudioSwitch: boolean
  onChangeAudioLang: (lang: AudioLang) => void
  onClose: () => void
}) {
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 350, delay: 200, useNativeDriver: true }).start()
  }, [])

  // El bloqueo a horizontal se aplica en un efecto, o sea DESPUÉS del primer
  // render: se alcanzaba a pintar un frame en vertical y el layout reacomodaba
  // a la vista, que es el "salta de vertical a horizontal" feo. Mientras no
  // haya girado se muestra solo negro; el contenido entra con un fundido una
  // vez que la orientación se asentó.
  const { width: winW, height: winH } = useWindowDimensions()
  const isLandscape = winW > winH
  const settle = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!isLandscape) return
    Animated.timing(settle, { toValue: 1, duration: 220, useNativeDriver: true }).start()
  }, [isLandscape])

  const backdropUri = backdropUrl(backdrop, 'w780')

  if (!isLandscape) return <View style={styles.loadingRoot} />

  return (
    <Animated.View style={[styles.loadingRoot, { opacity: settle }]}>
      {backdropUri && (
        <Image source={backdropUri} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
      )}
      <View style={styles.loadingScrim} />

      {/* Salida: sin esto, un título que tarda en resolver dejaba al usuario
          encerrado hasta que fallara o terminara. */}
      <Touchable
        scaleTo={0.88}
        haptic="light"
        style={styles.loadingClose}
        onPress={onClose}
        hitSlop={12}
      >
        <BlurView intensity={55} tint="dark" style={styles.loadingCloseBlur}>
          <SymbolView name="xmark" tintColor="#fff" style={styles.loadingCloseIcon} />
        </BlurView>
      </Touchable>

      <View style={styles.loadingCenter}>
        <ActivityIndicator color="#fff" size="small" />
        {!!title && (
          <Text style={styles.loadingTitle} numberOfLines={1}>
            {title}{episodeLabel ? `  ·  ${episodeLabel}` : ''}
          </Text>
        )}
      </View>

      {/* Selector de audio: discreto, aparece un instante después para no competir
          visualmente con el spinner — la carga arranca sola con la preferencia guardada.
          bottom fijo, sin insets.bottom: esta pantalla ahora se muestra en el landscape
          forzado por lockAsync (ver PlayerScreen) desde el primer frame, y ese landscape
          no es una rotación física real — el safe-area-context a veces arrastra el inset
          de portrait ahí (mismo problema ya documentado en VlcPlayer para la barra
          superior y el overlay de subtítulos). */}
      {showAudioSwitch && (
        <Animated.View style={[styles.langSwitch, { bottom: 40, opacity: fade }]}>
          <BlurView intensity={70} tint="systemChromeMaterialDark" style={styles.langSegmented}>
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
          </BlurView>
        </Animated.View>
      )}
    </Animated.View>
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

type TrackInfo = { id: number; label: string; lang?: string }

// ¿Esta pista embebida es española? VLCKit expone `language` (ISO 639) además
// del título; antes se descartaba y solo se miraba el título, que en muchos
// MKV viene vacío o genérico ("Track 3").
function isSpanishTrack(t: TrackInfo): boolean {
  const lang = (t.lang ?? '').toLowerCase()
  if (lang.startsWith('es') || lang.startsWith('spa')) return true
  return /\b(?:spa|esp|spanish|español|latino|castellano)\b/i.test(t.label)
}

function VlcPlayer({
  uri, referer, srtCues, startAt, meta, hasNext, title, episodeLabel,
  audioLang, hasLatinoAlternative, onChangeAudioLang,
  sources, sourcesLoading, activeSourceIndex, onPickSource, onPosition,
  onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  srtCues: SrtCue[]
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  audioLang: AudioLang
  hasLatinoAlternative: boolean
  onChangeAudioLang: (lang: AudioLang) => void
  // Selector de calidad. `onPickSource` ausente = la pestaña no se muestra
  // (p. ej. reproduciendo una descarga local, donde no hay otras fuentes).
  sources: SourceOption[]
  sourcesLoading: boolean
  activeSourceIndex: number | null
  onPickSource?: (i: number) => void
  onPosition?: (t: number) => void
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
}) {
  const insets = useSafeAreaInsets()
  const { width: winWidth, height: winHeight } = useWindowDimensions()
  // top fijo (no insets.top): en este landscape forzado por lockAsync (no una
  // rotación física real) safe-area-context a veces arrastra el inset de
  // portrait y empuja todo mucho más abajo de lo que hace falta — mismo
  // problema ya documentado para insets.bottom en el overlay de subtítulos.
  const topBarTop = 16
  // Tamaño fijo del dropdown (no crece con la cantidad de pistas ni se achica
  // con poco contenido) — clamp solo como red de seguridad en pantallas bajas
  // para que nunca se salga del área visible ni llegue a la barra de abajo.
  const dropdownTop = topBarTop + 44
  const dropdownHeight = Math.min(280, winHeight - dropdownTop - 70)
  const vlcRef = useRef<VideoVLCRef>(null)
  const lastSave = useRef(0)
  const progressRef = useRef({ time: 0, duration: 0 })
  const startedRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seeking = useRef(false)
  const seekGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSeekTarget = useRef<number | null>(null)
  const seekGuardUntil = useRef(0)

  // "Llenar pantalla" (recorta bordes, sin barras negras) vs "Ajustar"
  // (default, ve el frame completo) — binario, como Netflix/HBO, disparado
  // por pellizco en vez de doble tap. VLCKit ya soporta esto nativamente vía
  // resizeMode, no hace falta ningún transform de zoom manual en JS.
  const [filled, setFilled] = useState(false)
  const [fillHintVisible, setFillHintVisible] = useState(false)
  const fillHintOpacity = useRef(new Animated.Value(0)).current
  const fillHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Doble tap a la izquierda/derecha = retroceder/adelantar 10s (Netflix/
  // YouTube). Va sobre el mismo Pressable que ya maneja el tap simple
  // (mostrar/ocultar controles) — no un gesture-handler nuevo, porque
  // Gesture.Tap() está confirmado roto en este setup (ver comentario más
  // abajo en pinchGesture). CLAVE de UX: el tap simple alterna los controles
  // AL INSTANTE (no espera a ver si viene un segundo tap — esa espera se
  // sentía como un delay feo). Si resulta ser doble tap, revertimos ese
  // toggle instantáneo y hacemos el seek — controlsBeforeTap guarda el estado
  // previo para poder revertir.
  const lastTap = useRef<{ time: number; side: 'left' | 'right' } | null>(null)
  const controlsBeforeTap = useRef(true)
  const [seekHint, setSeekHint] = useState<'left' | 'right' | null>(null)
  const seekHintOpacity = useRef(new Animated.Value(0)).current
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([])
  const [textTracks, setTextTracks] = useState<TrackInfo[]>([])
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(-1)
  const [trackPicker, setTrackPicker] = useState<'audio' | 'text' | 'style' | 'quality' | null>(null)

  // Selección de subtítulo: 'external' = el .srt en español que bajamos y
  // renderizamos nosotros (overlay JS); 'none' = apagado; number = id de una
  // pista embebida en el archivo (nativa de VLCKit). Si hay español
  // disponible arranca ahí — es la razón de todo este trabajo.
  const [subMode, setSubMode] = useState<'external' | 'none' | number>(
    srtCues.length > 0 ? 'external' : 'none'
  )
  // srtCues ya no está listo al montar (la descarga corre en paralelo, no
  // bloquea el arranque — ver resolve() en PlayerScreen), así que el
  // useState de arriba casi siempre inicializa en 'none'. Este efecto elige
  // solo, con precedencia explícita, y nunca pisa una elección manual:
  //
  //   1. El .srt externo, si llegó: lo renderizamos nosotros, así que el
  //      estilo (tamaño/color/fondo) se puede cambiar al instante.
  //   2. Si no hay .srt, una pista embebida en español del propio MKV.
  //
  // El paso 2 es nuevo: antes, si Wyzie no tenía español para ese título, el
  // video arrancaba sin subtítulos aunque el archivo trajera pistas.
  // Ambas dependencias en el array: cualquiera de las dos puede llegar
  // primero (la descarga del .srt compite con el onLoad de VLCKit).
  const subModeChosenByUser = useRef(false)
  useEffect(() => {
    if (subModeChosenByUser.current) return
    if (srtCues.length > 0) { setSubMode('external'); return }
    const embedded = textTracks.find(isSpanishTrack)
    if (embedded) setSubMode(embedded.id)
  }, [srtCues, textTracks])
  function chooseSubMode(mode: 'external' | 'none' | number) {
    subModeChosenByUser.current = true
    setSubMode(mode)
  }
  const activeCue = subMode === 'external' ? findActiveCue(srtCues, position) : null

  const [subStyle, setSubStyleState] = useState<SubtitleStyleT>(DEFAULT_SUBTITLE_STYLE)
  useEffect(() => { getSubtitleStyle().then(setSubStyleState) }, [])
  function changeSubStyle(patch: Partial<SubtitleStyleT>) {
    const next = { ...subStyle, ...patch }
    setSubStyleState(next)
    setSubtitleStyle(next)
  }

  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3500)
  }

  useEffect(() => {
    scheduleHide()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (fillHintTimer.current) clearTimeout(fillHintTimer.current)
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current)
    }
  }, [])

  // Mientras el dropdown de audio/subtítulos/estilo está abierto, los
  // controles (y el botón "..." que lo ancla) no se pueden esconder solos —
  // si no, a los 3.5s desaparece la barra de arriba y el dropdown queda
  // flotando sin nada a lo que estar anclado.
  useEffect(() => {
    if (trackPicker) {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      scheduleHide()
    }
  }, [trackPicker])

  // (El lock de orientación landscape/portrait ahora lo maneja PlayerScreen a
  // nivel de pantalla — ver comentario allá. Antes vivía acá y el
  // portrait-al-desmontar causaba el parpadeo al cambiar de episodio.)

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

  const DOUBLE_TAP_MS = 280

  function showSeekHint(side: 'left' | 'right') {
    if (seekHintTimer.current) clearTimeout(seekHintTimer.current)
    setSeekHint(side)
    seekHintOpacity.setValue(1)
    seekHintTimer.current = setTimeout(() => {
      Animated.timing(seekHintOpacity, { toValue: 0, duration: 250, useNativeDriver: true })
        .start(() => setSeekHint(null))
    }, 450)
  }

  // Tap simple = mostrar/ocultar controles; doble tap en la mitad
  // izquierda/derecha = retroceder/adelantar 10s. Comparten el mismo Pressable.
  // El tap simple actúa YA (sin esperar la ventana de doble tap → sin delay).
  // Si el usuario sí hace doble tap, el segundo tap revierte el toggle que hizo
  // el primero (controlsBeforeTap) y hace el seek — la visibilidad de controles
  // queda neta igual que antes del gesto. El único costo es un parpadeo breve
  // de los controles durante el doble tap, aceptable a cambio de que el tap
  // simple (el 95% de los toques) sea instantáneo.
  function handleVideoPress(e: GestureResponderEvent) {
    const side: 'left' | 'right' = e.nativeEvent.locationX < winWidth / 2 ? 'left' : 'right'
    const now = Date.now()
    const last = lastTap.current

    if (last && last.side === side && now - last.time < DOUBLE_TAP_MS) {
      lastTap.current = null
      // Revertir el toggle instantáneo del primer tap.
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setControlsVisible(controlsBeforeTap.current)
      if (controlsBeforeTap.current) scheduleHide()
      skipBy(side === 'right' ? 10 : -10)
      showSeekHint(side)
      return
    }

    lastTap.current = { time: now, side }
    controlsBeforeTap.current = controlsVisible
    toggleControls()
  }

  function setFilledWithHint(next: boolean) {
    setFilled((prev) => {
      if (prev === next) return prev
      // Ícono de feedback breve — sin esto el pellizco no da ninguna señal de
      // que pasó algo (el cambio de encuadre puede ser sutil según el video).
      if (fillHintTimer.current) clearTimeout(fillHintTimer.current)
      setFillHintVisible(true)
      fillHintOpacity.setValue(1)
      fillHintTimer.current = setTimeout(() => {
        Animated.timing(fillHintOpacity, { toValue: 0, duration: 300, useNativeDriver: true })
          .start(() => setFillHintVisible(false))
      }, 500)
      return next
    })
  }

  // Pellizco (ajustar/llenar, binario — no zoom continuo) + tap (mostrar/
  // ocultar controles) sobre la misma vista. Gesture.Race, no Simultaneous:
  // tap y pellizco son alternativas excluyentes (o uno o el otro, nunca de
  // verdad "a la vez"), y Race deja que el primero en activar gane sin que
  // el otro interfiera — con Simultaneous el tap dejó de disparar.
  // scale > 1 = dedos separándose (pellizco "hacia afuera") → llenar.
  // scale < 1 = dedos juntándose (pellizco "hacia adentro") → ajustar.
  //
  // useMemo con deps vacías: sin esto, los objetos Gesture.* se recrean en
  // cada render y GestureDetector reconfigura el reconocedor nativo cada vez.
  // Los callbacks usan actualizaciones funcionales de estado (setX(prev =>
  // ...)) así que no necesitan closures frescas — son seguros de fijar una
  // sola vez.
  //
  // Gesture.Tap() de la API nueva quedó descartado para el toggle de
  // controles: con logs confirmé que se queda pegado en "begin" sin llegar
  // NUNCA a "end" ni "finalize", de forma consistente y reproducible — un
  // bug real de esa API en este setup, no una carrera de estado. En cambio,
  // Pressable (RN puro, sin gesture-handler) viene funcionando bien toda la
  // sesión para CADA OTRO botón de esta pantalla (X, play/pause, skip, filas
  // del picker) — así que el tap-para-mostrar-controles vuelve a Pressable,
  // ANIDADO adentro del mismo GestureDetector (no como hermano compitiendo,
  // que fue el problema original con el pellizco).
  const pinchGesture = useMemo(
    () => Gesture.Pinch()
      .runOnJS(true)
      .onEnd((e) => {
        if (e.scale > 1.15) setFilledWithHint(true)
        else if (e.scale < 0.85) setFilledWithHint(false)
      }),
    []
  )

  function handleLoad(data: OnLoadData) {
    setBuffering(false) // red de seguridad: onVideoLoad siempre llega al arrancar, aunque se pierda algún evento de buffer
    setDuration(data.duration)
    setAudioTracks(data.audioTracks.map((t) => ({
      id: t.id, label: t.title || t.language || `Pista ${t.id}`, lang: t.language,
    })))
    // Se conserva `language`: es lo que permite reconocer una pista española
    // cuando el MKV no la titula (ver isSpanishTrack y el efecto de subMode).
    setTextTracks(data.textTracks.map((t) => ({
      id: t.id, label: t.title || t.language || `Subtítulo ${t.id}`, lang: t.language,
    })))
    const selAudio = data.audioTracks.find((t) => t.selected)
    // El archivo puede traer varias pistas de audio embebidas (ej. dual audio
    // inglés/latino) y VLCKit no siempre elige la correcta por defecto — suele
    // quedarse en la primera. Si pedimos latino, buscamos una pista cuyo
    // nombre lo indique y la forzamos; si el archivo no la nombra (pistas
    // genéricas "Track 1"/"Track 2"), no hay forma de saberlo desde acá y
    // queda el default de VLCKit.
    const latinoTrack = audioLang === 'latino'
      ? data.audioTracks.find((t) => /spa|esp|latino|castellano/i.test(t.title ?? ''))
      : undefined
    setSelectedAudioTrack(latinoTrack ? latinoTrack.id : selAudio ? selAudio.id : -1)
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

    // Si llega un progress event es porque el video está decodificando de
    // verdad — usamos eso como prueba definitiva de que no está bufferizando,
    // incluso si en algún momento se perdió el aviso nativo de "ya terminé de
    // bufferizar" (pasaba: quedaba el spinner pegado con el video ya andando).
    if (buffering) setBuffering(false)

    progressRef.current = { time: data.currentTime, duration: data.seekableDuration }
    // La pantalla necesita la posición en vivo para poder retomarla al cambiar
    // de fuente; el progreso guardado va throttleado a 5s y serviría un valor
    // viejo.
    onPosition?.(data.currentTime)
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
      {/* GestureDetector (pellizco) envuelve SOLO el video — si envolviera
          toda la pantalla (controles incluidos), les robaría el toque a los
          botones. El Pressable (tap → mostrar/ocultar controles) va ANIDADO
          adentro, no como hermano compitiendo — mismo motivo. */}
      <GestureDetector gesture={pinchGesture}>
        <View style={[styles.fill, styles.vlcZoomClip]}>
          <Pressable style={styles.fill} onPress={handleVideoPress}>
          <VideoVLC
            ref={vlcRef}
            style={styles.fill}
            initialSource={{ uri, headers: referer ? { Referer: referer } : undefined }}
            paused={paused}
            resizeMode={filled ? 'cover' : 'none'}
            progressUpdateInterval={500}
            selectedAudioTrack={selectedAudioTrack}
            selectedTextTrack={typeof subMode === 'number' ? subMode : -1}
            onLoad={handleLoad}
            onProgress={handleProgress}
            onBuffer={handleBuffer}
            onError={handleError}
            onEnd={onEnded}
          />
          {activeCue && (
            // bottom fijo, sin insets.bottom: en landscape forzado por
            // lockAsync (no una rotación física real), el safe-area-context
            // a veces no vuelve a medir bien y arrastra el inset de portrait
            // — sumaba altura de más sin que se note por qué.
            <View
              pointerEvents="none"
              style={[styles.subtitleOverlay, { bottom: 22 }]}
            >
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
          </Pressable>
        </View>
      </GestureDetector>

      {fillHintVisible && (
        <Animated.View style={[styles.fillHint, { opacity: fillHintOpacity }]} pointerEvents="none">
          <SymbolView
            name={filled ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
            tintColor="#fff"
            style={styles.fillHintIcon}
          />
          <Text style={styles.fillHintText}>{filled ? 'Pantalla completa' : 'Ajustar'}</Text>
        </Animated.View>
      )}

      {seekHint && (
        <Animated.View
          style={[
            styles.seekHint,
            seekHint === 'left' ? styles.seekHintLeft : styles.seekHintRight,
            { opacity: seekHintOpacity },
          ]}
          pointerEvents="none"
        >
          <SymbolView
            name={seekHint === 'left' ? 'gobackward.10' : 'goforward.10'}
            tintColor="#fff"
            style={styles.fillHintIcon}
          />
        </Animated.View>
      )}

      {buffering && (
        <View style={[StyleSheet.absoluteFillObject, styles.vlcBufferCenter]} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}

      {controlsVisible && (
        // box-none: el contenedor en sí no debe interceptar toques (si no,
        // compite con el GestureDetector del video de abajo y le cancela el
        // tap — confirmado con logs: el primer tap and abrir controles
        // funcionaba, el segundo para cerrarlos fallaba justo apenas esta
        // vista se montaba). Los botones de adentro (Touchable/Slider) tienen
        // su propio manejo de toque y siguen andando igual con box-none.
        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
          <View style={styles.vlcScrim} pointerEvents="none" />

          {/* Barra superior: cerrar + pistas */}
          <View style={[styles.vlcTopBar, { top: topBarTop }]}>
            <Touchable scaleTo={0.9} haptic="light" style={styles.vlcIconBtn} onPress={() => onClose(duration > 0 ? position / duration : 0)}>
              <SymbolView name="xmark" tintColor="#fff" style={styles.vlcIcon} />
            </Touchable>
            {!buffering && (
              <Touchable
                scaleTo={0.9} haptic="light" style={styles.vlcIconBtn}
                onPress={() => setTrackPicker((p) => (p ? null : 'audio'))}
              >
                <SymbolView name="ellipsis" tintColor="#fff" style={styles.vlcIcon} />
              </Touchable>
            )}
          </View>

          {/* Play/pause + retroceder/adelantar 10s — ocultos mientras buffering,
              si no quedaban superpuestos con el spinner de carga. */}
          {!buffering && (
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
          )}

          {/* Título sobre la barra, alineado a la izquierda con el scrubber.
              En series se muestra la temporada y el episodio en una segunda
              línea, más apagada, para que el título siga siendo lo dominante. */}
          <View style={[styles.vlcTitleBlock, { bottom: insets.bottom + 58 }]} pointerEvents="none">
            <Text style={styles.vlcTitleText} numberOfLines={1}>{title}</Text>
            {!!episodeLabel && (
              <Text style={styles.vlcEpisodeText} numberOfLines={1}>{episodeLabel}</Text>
            )}
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
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setTrackPicker(null)} />
          <View style={[styles.vlcDropdownWrap, { top: dropdownTop, height: dropdownHeight }]}>
            <BlurView intensity={78} tint="systemChromeMaterialDark" style={styles.vlcPickerCard}>
              <LinearGradient
                colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
                locations={[0, 0.6]}
                style={styles.vlcPickerSheen}
                pointerEvents="none"
              />

              <View style={styles.vlcPickerTabs}>
                {/* Touchable envuelve el style recibido en un Animated.View
                    ANIDADO dentro de su propio Pressable — el flex:1 de
                    vlcPickerTab nunca llegaba al ítem real de la fila (el
                    Pressable), así que los 3 tabs colapsaban a su ancho
                    mínimo en vez de repartirse el espacio. Por eso el
                    flex:1 va en este wrapper, no en el Touchable. */}
                <View style={styles.vlcPickerTabSlot}>
                  <Touchable
                    scaleTo={0.94} haptic="selection"
                    style={[styles.vlcPickerTab, trackPicker === 'audio' && styles.vlcPickerTabActive]}
                    onPress={() => setTrackPicker('audio')}
                  >
                    <SymbolView name="waveform" tintColor={trackPicker === 'audio' ? '#000' : '#fff'} style={styles.vlcIconSm} />
                  </Touchable>
                </View>
                <View style={styles.vlcPickerTabSlot}>
                  <Touchable
                    scaleTo={0.94} haptic="selection"
                    style={[styles.vlcPickerTab, trackPicker === 'text' && styles.vlcPickerTabActive]}
                    onPress={() => setTrackPicker('text')}
                  >
                    <SymbolView name="captions.bubble" tintColor={trackPicker === 'text' ? '#000' : '#fff'} style={styles.vlcIconSm} />
                  </Touchable>
                </View>
                {srtCues.length > 0 && (
                  <View style={styles.vlcPickerTabSlot}>
                    <Touchable
                      scaleTo={0.94} haptic="selection"
                      style={[styles.vlcPickerTab, trackPicker === 'style' && styles.vlcPickerTabActive]}
                      onPress={() => setTrackPicker('style')}
                    >
                      <SymbolView name="textformat.size" tintColor={trackPicker === 'style' ? '#000' : '#fff'} style={styles.vlcIconSm} />
                    </Touchable>
                  </View>
                )}
                {onPickSource && (
                  <View style={styles.vlcPickerTabSlot}>
                    <Touchable
                      scaleTo={0.94} haptic="selection"
                      style={[styles.vlcPickerTab, trackPicker === 'quality' && styles.vlcPickerTabActive]}
                      onPress={() => setTrackPicker('quality')}
                    >
                      <SymbolView name="4k.tv" tintColor={trackPicker === 'quality' ? '#000' : '#fff'} style={styles.vlcIconSm} />
                    </Touchable>
                  </View>
                )}
              </View>

              {trackPicker === 'audio' && (audioLang === 'latino' || hasLatinoAlternative) && (
                <Touchable
                  scaleTo={0.98}
                  haptic="selection"
                  style={styles.vlcPickerSwitchRow}
                  onPress={() => {
                    onChangeAudioLang(audioLang === 'latino' ? 'original' : 'latino')
                    setTrackPicker(null)
                  }}
                >
                  <SymbolView name="arrow.triangle.2.circlepath" tintColor="#fff" style={styles.vlcIcon} />
                  <Text style={styles.vlcPickerSwitchText} numberOfLines={1}>
                    {audioLang === 'latino' ? 'Volver a audio Original' : 'Cambiar a fuente con audio Latino'}
                  </Text>
                </Touchable>
              )}

              {trackPicker === 'style' ? (
                <View style={styles.vlcStyleContent}>
                  <SubtitleStyleRow
                    label="Tamaño"
                    value={subStyle.size}
                    options={[
                      { value: 'small', label: 'Chico' },
                      { value: 'medium', label: 'Medio' },
                      { value: 'large', label: 'Grande' },
                    ]}
                    onChange={(size) => changeSubStyle({ size })}
                  />
                  <SubtitleStyleRow
                    label="Color"
                    value={subStyle.color}
                    options={[
                      { value: 'white', label: 'Blanco' },
                      { value: 'yellow', label: 'Amarillo' },
                      { value: 'cyan', label: 'Cian' },
                    ]}
                    onChange={(color) => changeSubStyle({ color })}
                  />
                  <SubtitleStyleRow
                    label="Fondo"
                    value={subStyle.background}
                    options={[
                      { value: 'none', label: 'Ninguno' },
                      { value: 'semi', label: 'Semitransparente' },
                    ]}
                    onChange={(background) => changeSubStyle({ background })}
                  />
                </View>
              ) : (
                <ScrollView
                  style={styles.vlcPickerList}
                  contentContainerStyle={styles.vlcPickerListContent}
                  showsVerticalScrollIndicator={false}
                >
                  {trackPicker === 'audio' && audioTracks.map((t) => {
                    const selected = selectedAudioTrack === t.id
                    return (
                      <Touchable
                        key={t.id}
                        scaleTo={0.98}
                        haptic="selection"
                        style={styles.vlcPickerRow}
                        onPress={() => { setSelectedAudioTrack(t.id); setTrackPicker(null) }}
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

                  {trackPicker === 'quality' && (
                    sourcesLoading ? (
                      <ActivityIndicator color="#fff" style={styles.vlcPickerLoading} />
                    ) : sources.length === 0 ? (
                      <Text style={styles.vlcPickerEmpty}>No hay otras fuentes disponibles</Text>
                    ) : (
                      sources.map((s) => {
                        const active = s.i === activeSourceIndex
                        return (
                          <Touchable
                            key={s.i}
                            scaleTo={0.98}
                            haptic="selection"
                            style={styles.vlcPickerRow}
                            onPress={() => { onPickSource?.(s.i); setTrackPicker(null) }}
                          >
                            <View style={styles.vlcQualityInfo}>
                              <Text style={[styles.vlcPickerRowText, active && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                                {describeSource(s)}
                              </Text>
                              <Text style={styles.vlcQualitySub} numberOfLines={1}>{s.label}</Text>
                            </View>
                            {active && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                          </Touchable>
                        )
                      })
                    )
                  )}

                  {trackPicker === 'text' && (
                    <>
                      {srtCues.length > 0 && (
                        <Touchable
                          scaleTo={0.98}
                          haptic="selection"
                          style={styles.vlcPickerRow}
                          onPress={() => { chooseSubMode('external'); setTrackPicker(null) }}
                        >
                          <Text style={[styles.vlcPickerRowText, subMode === 'external' && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                            Español
                          </Text>
                          {subMode === 'external' && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                        </Touchable>
                      )}
                      <Touchable
                        scaleTo={0.98}
                        haptic="selection"
                        style={styles.vlcPickerRow}
                        onPress={() => { chooseSubMode('none'); setTrackPicker(null) }}
                      >
                        <Text style={[styles.vlcPickerRowText, subMode === 'none' && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                          Ninguno
                        </Text>
                        {subMode === 'none' && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                      </Touchable>
                      {textTracks.map((t) => {
                        const selected = subMode === t.id
                        return (
                          <Touchable
                            key={t.id}
                            scaleTo={0.98}
                            haptic="selection"
                            style={styles.vlcPickerRow}
                            onPress={() => { chooseSubMode(t.id); setTrackPicker(null) }}
                          >
                            <Text style={[styles.vlcPickerRowText, selected && styles.vlcPickerRowTextActive]} numberOfLines={1}>
                              {t.label}
                            </Text>
                            {selected && <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.vlcIcon} />}
                          </Touchable>
                        )
                      })}
                      {srtCues.length === 0 && textTracks.length === 0 && (
                        <Text style={styles.vlcPickerEmpty}>Esta fuente no trae subtítulos</Text>
                      )}
                    </>
                  )}
                </ScrollView>
              )}
            </BlurView>
          </View>
        </View>
      )}
    </View>
  )
}

// Fila de chips para el picker de "Estilo" de subtítulos (tamaño/color/fondo).
function SubtitleStyleRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <View style={styles.vlcStyleRow}>
      <Text style={styles.vlcStyleLabel}>{label}</Text>
      <View style={styles.vlcStyleChips}>
        {options.map((opt) => {
          const selected = opt.value === value
          return (
            <Touchable
              key={opt.value}
              scaleTo={0.95}
              haptic="selection"
              style={[styles.vlcStyleChip, selected && styles.vlcStyleChipActive]}
              onPress={() => onChange(opt.value)}
            >
              <Text style={[styles.vlcStyleChipText, selected && styles.vlcStyleChipTextActive]} numberOfLines={1}>
                {opt.label}
              </Text>
            </Touchable>
          )
        })}
      </View>
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
  // top/right fijos y no insets: en el landscape forzado por lockAsync el
  // safe-area-context a veces arrastra los insets de portrait (mismo problema
  // ya documentado para la barra superior del VlcPlayer).
  loadingClose: {
    position: 'absolute', top: 16, right: 20,
    width: 34, height: 34, borderRadius: 17, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
  },
  loadingCloseBlur: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingCloseIcon: { width: 13, height: 13 },

  // Selector de idioma de audio: flotante, discreto, abajo del todo
  langSwitch: { position: 'absolute', left: 0, right: 0, bottom: 56, alignItems: 'center' },
  langSegmented: {
    flexDirection: 'row',
    borderRadius: 16, padding: 4, gap: 4,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
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
  // Feedback breve al pellizco de ajustar/llenar pantalla.
  fillHint: {
    position: 'absolute', top: '46%', left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  fillHintIcon: { width: 26, height: 26 },
  fillHintText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // Feedback breve al doble tap de retroceder/adelantar 10s — un círculo
  // translúcido centrado en la mitad de pantalla que se tocó.
  seekHint: {
    position: 'absolute', top: '50%', marginTop: -34,
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  seekHintLeft: { left: '18%' },
  seekHintRight: { right: '18%' },
  // Overlay del subtítulo en español (renderizado en JS, no por VLCKit — ver
  // downloadSpanishSubs/SrtCue). `bottom` se anima según si los controles
  // están visibles para no quedar tapado por la barra de progreso.
  subtitleOverlay: {
    position: 'absolute', left: 20, right: 20,
    alignItems: 'center',
  },
  subtitleText: {
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
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
  // left: 16 (margen de la barra) + 48 (ancho del tiempo) → arranca donde
  // arranca el scrubber, no donde arranca el "1:26:04". Así queda ópticamente
  // alineado con la barra y no con el borde.
  vlcTitleBlock: { position: 'absolute', left: 64, right: 64 },
  vlcTitleText: {
    color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.3,
    // Sombra: el título va sobre el video, y sin ella desaparece en escenas claras.
    textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 6,
  },
  vlcEpisodeText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13.5, fontWeight: '500', marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 6,
  },
  vlcSlider: { flex: 1, height: 32 },
  // Dropdown disimulado anclado al botón de "..." del top bar — no tapa la
  // pantalla, solo la tarjeta liquid glass flota cerca del ancla.
  vlcDropdownWrap: {
    position: 'absolute', right: 16,
    width: 320,
    borderRadius: 22,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
  },
  vlcPickerCard: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
    paddingTop: 12, paddingHorizontal: 10, paddingBottom: 10,
  },
  // Brillo sutil arriba — lo que le da el aire "vidrio" en vez de "panel gris".
  vlcPickerSheen: { ...StyleSheet.absoluteFillObject, height: '45%' },
  vlcPickerTabs: {
    flexDirection: 'row', gap: 6,
    backgroundColor: 'rgba(120,120,128,0.24)',
    borderRadius: 16, padding: 4, marginBottom: 10,
  },
  // El flex:1 real vive acá (no en vlcPickerTab) — ver comentario en el JSX.
  vlcPickerTabSlot: { flex: 1 },
  vlcPickerLoading: { paddingVertical: 26 },
  // La fila de calidad lleva dos líneas, así que el texto necesita su propia
  // columna para no empujar al checkmark fuera de la tarjeta.
  vlcQualityInfo: { flex: 1, gap: 2 },
  vlcQualitySub: { color: 'rgba(255,255,255,0.38)', fontSize: 11.5 },
  vlcPickerTab: {
    paddingVertical: 9, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  vlcPickerTabActive: { backgroundColor: '#fff' },
  vlcIconSm: { width: 16, height: 16 },
  vlcPickerSwitchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  vlcPickerSwitchText: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  // flex:1 en vez de maxHeight — llena siempre el alto fijo del dropdown
  // (dropdownHeight, calculado en VlcPlayer), scrollea si hay más pistas de
  // las que entran, en vez de estirar la tarjeta entera.
  vlcPickerList: { flex: 1 },
  vlcPickerListContent: { flexGrow: 1, justifyContent: 'center' },
  vlcPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12, gap: 10,
    borderRadius: 14,
  },
  vlcPickerRowText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, flexShrink: 1 },
  vlcPickerRowTextActive: { color: '#fff', fontWeight: '700' },
  vlcPickerEmpty: {
    color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center',
    paddingVertical: 20, paddingHorizontal: 12,
  },

  // Picker de "Estilo" de subtítulos — las etiquetas "flotan" con text-shadow
  // sutil (sin fondo propio, como si estuvieran suspendidas sobre el vidrio).
  // flex:1 + centrado: llena el mismo alto fijo que la lista de pistas.
  vlcStyleContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 4, gap: 16 },
  vlcStyleRow: { gap: 10 },
  vlcStyleLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1.1, paddingHorizontal: 4,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  vlcStyleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 4 },
  vlcStyleChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  vlcStyleChipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  vlcStyleChipText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  vlcStyleChipTextActive: { color: '#000', fontWeight: '700' },

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
