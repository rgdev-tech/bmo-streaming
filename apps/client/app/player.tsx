import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Animated, Pressable, ScrollView, useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native'
import { Image } from 'expo-image'
// expo-file-system v19 (SDK 54) movió esta API a /legacy; la nueva es File/Directory.
import * as FileSystem from 'expo-file-system/legacy'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEventListener } from 'expo'
import { SymbolView } from 'expo-symbols'
import Slider from '@react-native-community/slider'
import * as ScreenOrientation from 'expo-screen-orientation'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream, type AudioLang, type Subtitle, type SourceOption } from '@/lib/stream'
// Persistir estilo/sincronía ya no se hace acá: lo maneja useSubtitlePrefs.
// De este módulo solo quedan los mapas que traducen la preferencia a estilos RN.
import {
  SUBTITLE_FONT_SIZE, SUBTITLE_COLOR_CSS,
  SUBTITLE_OUTLINE, SUBTITLE_POSITION_BOTTOM, SUBTITLE_OPACITY_VALUE,
} from '@/lib/subtitleStyle'
import { decodeSrtBytes, parseSrt, findActiveCue, type SrtCue } from '@/lib/srt'
import { getProgress, setUpNext, type Progress } from '@/lib/library'
// Guardado de progreso y helpers compartidos con apps/tv (headless).
import {
  usePlaybackSource, useProgressSaver, useSpanishSubs, useSubtitlePrefs,
  describeSource, describePlaybackError, audioLangLabel, fmt,
  type SpanishSubsFetcher,
} from '@bmo/player'
import { backdropUrl, tmdb } from '@/lib/tmdb'
import { getLocalPath, smartDownloadNext } from '@/lib/download'
import { Touchable } from '@/components/Touchable'
import { AirPlayButton, isAirPlayConnected } from '@/modules/airplay'
import VideoVLC from '@/vendor/react-native-video-vlc/src/VideoVLC'
import type {
  VideoVLCRef,
  OnLoadData, OnProgressData, OnVideoErrorData, OnBufferData,
} from '@/vendor/react-native-video-vlc/src'
import { colors } from '@/lib/theme'

const COUNTDOWN_S = 8
const FINISHED_RATIO = 0.9 // visto "completo" → ofrecer siguiente episodio
const NEXT_PILL_S = 50      // segundos finales en que aparece el pill "Siguiente"

// Descarga el subtítulo en español a disco (caché), lo parsea y devuelve las
// cues listas para renderizar como overlay en JS — no va a VLCKit: el estilo
// (tamaño/color/fondo) tiene que poder cambiar al instante, y las opciones de
// subtítulo de libvlc son de instancia (recrear el player entero, con re-buffer
// de red incluido, cada vez que el usuario toca "Grande"). Se baja DESDE EL
// TELÉFONO (no el servidor, cuya IP de datacenter bloquea Cloudflare en
// dl.opensubtitles.org). Corre en paralelo DESPUÉS de montar el player (no
// bloquea el arranque del video) — el overlay JS solo recoge las cues cuando
// llegan, sin ninguna carrera con el montaje nativo.
// Además de las cues devuelve un DIAGNÓSTICO legible de por qué no hay
// subtítulo, que el menú muestra en pantalla. Antes esto solo iba a console.log,
// o sea que para saber por qué faltaba el español había que tener el teléfono
// enchufado a Metro — imposible de averiguar para quien solo usa la app.
export type SubsOutcome = { cues: SrtCue[]; diagnosis: string }

async function downloadSpanishSubs(
  subs: Subtitle[], type: string, id: string, season?: number, episode?: number,
): Promise<SubsOutcome> {
  const esSubs = subs.filter((s) => s.lang === 'es')
  if (!esSubs.length) {
    console.log('[subs] sin candidatos en español')
    return { cues: [], diagnosis: 'La fuente no ofreció ningún subtítulo en español.' }
  }
  const dir = `${FileSystem.cacheDirectory}subs/`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  console.log(`[subs] ${esSubs.length} candidato(s) español para ${type}/${id} T${season}:E${episode}`)

  // Se queda con el motivo del ÚLTIMO intento fallido: es el más informativo
  // porque los candidatos se prueban en orden de preferencia.
  let lastFailure = 'Ningún candidato en español se pudo descargar.'

  for (const s of esSubs) {
    const localPath = `${dir}${type}-${id}-${season ?? 0}-${episode ?? 0}-${s.i}.srt`
    // No confiar solo en "existe": una descarga vieja/interrumpida puede haber
    // dejado un archivo chico/corrupto, y quedaría cacheado para siempre.
    const cached = await FileSystem.getInfoAsync(localPath, { size: true })
    if (cached.exists && cached.size > 200) {
      console.log(`[subs] caché (${cached.size}b): ${localPath}`)
      const cues = await readAndParseSrt(localPath)
      if (cues.length) return { cues, diagnosis: '' }
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    } else if (cached.exists) {
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    }
    for (const url of [s.url, ...s.altUrls]) {
      try {
        const dl = await FileSystem.downloadAsync(url, localPath)
        console.log(`[subs] GET ${url} → ${dl.status}`)
        if (dl.status !== 200) {
          lastFailure = `El servidor de subtítulos respondió ${dl.status}.`
          continue
        }
        // Un .srt real nunca es text/html; una página de bloqueo de Cloudflare sí.
        const ct = Object.entries(dl.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
        if (/text\/html/i.test(ct)) {
          console.log(`[subs] content-type=${ct} → bloqueo, descarto`)
          lastFailure = 'El host devolvió una página en vez del archivo (cuota de OpenSubtitles agotada o bloqueo).'
          await FileSystem.deleteAsync(localPath, { idempotent: true })
          continue
        }
        const cues = await readAndParseSrt(localPath)
        console.log(`[subs] OK: ${cues.length} cues parseadas de ${localPath}`)
        if (cues.length) return { cues, diagnosis: '' }
        lastFailure = 'El archivo se descargó pero no se pudo interpretar como subtítulo.'
        await FileSystem.deleteAsync(localPath, { idempotent: true })
      } catch (e) {
        console.log(`[subs] excepción ${url}: ${String(e)}`)
        lastFailure = `La descarga falló: ${String((e as Error)?.message ?? e).slice(0, 90)}`
      }
    }
  }
  console.log('[subs] ningún candidato dio cues válidas')
  return { cues: [], diagnosis: lastFailure }
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

  const [showNext, setShowNext] = useState(false)

  // ── Descarga local ──
  // Si el título está descargado se reproduce el archivo y NO se resuelve nada
  // contra el API. Hay que saberlo ANTES de dejar resolver: si no, se dispara un
  // resolve remoto que después se descarta.
  //
  // El resultado se guarda junto a la clave del episodio al que pertenece y solo
  // se acepta si esa clave sigue siendo la actual. Sin eso, al pasar de un
  // episodio descargado a uno que no lo está, el `localUri` viejo seguía vigente
  // durante unos renders y se reproducía el episodio equivocado.
  const localKey = `${id}-${isTv ? 'tv' : 'movie'}-${seasonN ?? 0}-${episodeN ?? 0}`
  const [localFound, setLocalFound] = useState<{ key: string; uri: string | null; startAt: number } | null>(
    params.localPath ? { key: localKey, uri: params.localPath, startAt: 0 } : null
  )
  useEffect(() => {
    let cancelled = false
    const mediaType = isTv ? 'tv' : 'movie'
    Promise.all([
      params.localPath
        ? Promise.resolve(params.localPath)
        : getLocalPath(Number(id), mediaType, seasonN, episodeN).catch(() => null),
      getProgress(Number(id), mediaType, seasonN, episodeN).catch(() => 0),
    ]).then(([uri, pos]) => {
      if (!cancelled) setLocalFound({ key: localKey, uri, startAt: pos })
    })
    return () => { cancelled = true }
  }, [localKey, params.localPath, id, isTv, seasonN, episodeN])

  // Solo vale si es del episodio que se está mirando ahora.
  const local = localFound?.key === localKey ? localFound : null
  const localUri = local?.uri ?? null

  // Toda la orquestación (resolver, fallback multi-fuente por `exclude`, menú de
  // calidad, idioma de audio) vive en @bmo/player, compartida con apps/tv. Antes
  // el teléfono tenía su propia copia SIN fallback: cuando la fuente elegida no
  // reproducía, la pantalla moría en "No se pudo cargar" y "Reintentar" volvía a
  // pedir la MISMA fuente (misma clave de caché en el API).
  const src = usePlaybackSource({
    type: isTv ? 'tv' : 'movie',
    id,
    season: seasonN,
    episode: episodeN,
    enabled: !!local && !local.uri,
  })

  // Posición a la que arrancar. La trae el hook, salvo en reproducción local
  // (que no pasa por él) o cuando el salto a AirPlay / la caída a otra fuente la
  // pisan con la posición en curso.
  const [startAtOverride, setStartAtOverride] = useState<number | null>(null)
  const startAt = startAtOverride ?? (localUri ? local!.startAt : src.startAt)
  const ready = localUri ? true : !!src.info

  // El error que se muestra es una frase, no el string técnico. El crudo se
  // manda a consola: sigue haciendo falta para diagnosticar desde Metro, pero
  // no es lo que tiene que leer alguien que solo quiere ver una película.
  const error = src.error
  const friendlyError = useMemo(() => describePlaybackError(error), [error])
  useEffect(() => {
    if (error) console.log(`[player] error: ${error}`)
  }, [error])

  const referer = src.info?.referer ?? ''
  const hasLatinoAlternative = src.info?.hasLatinoAlternative ?? false

  // Casting: al conectar una TV por AirPlay forzamos la vía HLS. AVPlayer
  // (expo-video) castea solo a AirPlay; las fuentes VLC/mkv de Real-Debrid no
  // pueden ir por AirPlay, así que re-resolvemos a un master HLS equivalente
  // (proxeado, ya inyecta el Referer). Sticky: una vez casteando seguimos en
  // HLS aunque cambie de episodio, para no parpadear montando VLC de nuevo.
  const [castForceHls, setCastForceHls] = useState(false)

  // La rotación entrada/salida se CUBRE con un overlay negro. iOS no puede
  // sincronizar el fade del modal (fullScreenModal) con el lockAsync imperativo,
  // así que sin esto se ve el contenido landscape achatado en un frame portrait
  // mientras gira — el "bug" visual. Con `oriented=false` pintamos negro por
  // encima de TODO hasta que el giro asentó (ver el effect de landscape). Al
  // salir, lo volvemos a poner ANTES de rotar y navegar, así el giro de vuelta a
  // portrait pasa detrás del negro y no se ve el reflow.
  const [oriented, setOriented] = useState(false)

  async function exitToBack() {
    setOriented(false)
    // Dos frames para que el negro llegue a pintarse antes de girar (uno solo
    // no alcanza: el primero programa el render, el segundo lo ve en pantalla).
    // Antes eran 50 ms fijos, que en un panel de 120 Hz son seis frames de
    // espera pura.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    // SIN await: la rotación a vertical y la navegación de vuelta corren a la
    // vez. Esperar a que el giro terminara para recién ahí llamar a router.back()
    // encadenaba dos animaciones de ~300 ms una detrás de la otra, y esa suma
    // es lo que hacía que salir del reproductor se sintiera pesado. Las dos
    // pasan detrás del overlay negro, así que solaparlas no descubre el reflow.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
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

  // Pre-resuelve el siguiente episodio en segundo plano, ya con el video andando.
  useEffect(() => {
    if (!src.info || !isTv) return
    stream.prewarm('tv', id, seasonN ?? 1, (episodeN ?? 1) + 1, src.audioLang)
  }, [src.info, isTv, id, seasonN, episodeN, src.audioLang])

  // El subtítulo en español NO bloquea el arranque: se baja en paralelo mientras
  // el player ya está montado y bufferizando, y el overlay JS lo recoge apenas
  // llega. La orquestación (cuándo bajarlo, re-bajarlo por fuente, limpiar las
  // cues viejas) es la misma que en la TV y vive en useSpanishSubs; lo único
  // propio del teléfono es CÓMO se baja: acá se cachea a disco, mientras que la
  // TV lo lee en memoria porque no tiene expo-file-system.
  // Por qué NO hay subtítulo español, para mostrarlo en el menú. El fetcher es
  // una función nuestra, así que reporta el motivo por acá y el contrato de
  // @bmo/player (que devuelve solo cues) queda intacto — la TV no se entera.
  const [subsDiagnosis, setSubsDiagnosis] = useState('')
  const fetchSubsToDisk = useCallback<SpanishSubsFetcher>(
    async (subs) => {
      setSubsDiagnosis('')
      const { cues, diagnosis } = await downloadSpanishSubs(subs, type, id, seasonN, episodeN)
      setSubsDiagnosis(diagnosis)
      return cues
    },
    [type, id, seasonN, episodeN]
  )
  // Con `info` en null (reproducción local) devuelve [] y no baja nada.
  const srtCues = useSpanishSubs(src.info, { fetcher: fetchSubsToDisk })

  // Una descarga puede ser de dos formas y cada una necesita un player
  // distinto: un m3u8 recompuesto a partir de segmentos (HLS → expo-video) o
  // un archivo único mkv/mp4 bajado de Real-Debrid (→ VLCKit). Antes se asumía
  // que todo lo local era HLS, así que un mkv descargado se le pasaba a
  // AVPlayer y no reproducía.
  const localIsFile = !!localUri && !localUri.endsWith('.m3u8')

  // URI final para la vía expo-video/HLS:
  //  - local: m3u8 descargado
  //  - hls: master proxeado por nuestro servidor (variantes + segmentos + subs)
  // Va con `src.excluded` para que el servidor salte las fuentes que ya fallaron
  // acá. No se usa resolvePlaybackUri porque el caso de AirPlay necesita un
  // master HLS incluso cuando la fuente resuelta es un mkv (ver castForceHls).
  const masterUrl = (localUri && !localIsFile ? localUri : null)
    ?? (isTv
      ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1, src.audioLang, src.excluded)
      : stream.masterMovie(id, src.audioLang, src.excluded))

  // Fuentes "file" → VLCKit: soporta mkv nativo y permite sideload/selección de
  // subtítulos y pistas de audio sin re-resolver. Cubre tanto el streaming
  // directo de Real-Debrid como un archivo ya descargado.
  const isVlcSource = localIsFile || (src.info?.type === 'file' && !localUri)
  // Al castear forzamos HLS (ver castForceHls): aunque la fuente sea VLC/mkv,
  // pasamos a NativePlayer con el master HLS para que AVPlayer lo mande a la TV.
  const useVlc = isVlcSource && !castForceHls
  // Para VLCKit: el archivo local manda sobre la URL remota.
  const vlcUri = localIsFile ? localUri! : src.info?.streamUrl ?? null

  // Orientación a nivel de PANTALLA, no por instancia de VlcPlayer ni por tipo
  // de fuente (el mismo lock sirve para VLC y para el fullscreen nativo de Apple).
  // La carga mientras resuelve es solo un spinner centrado (orientación-agnóstico),
  // y el reflow del giro lo tapa el overlay negro (ver `oriented`).
  // Fuerza landscape al entrar y marca `oriented` cuando el giro ASENTÓ, para
  // levantar el overlay negro recién ahí (no antes, o se ve el reflow). Detecta
  // el asentamiento por tres vías: si ya estábamos en landscape (no dispara
  // change), el evento de cambio de orientación, y un timeout de red de seguridad.
  useEffect(() => {
    let done = false
    const finish = () => { if (!done) { done = true; setOriented(true) } }
    const isLandscape = (o: ScreenOrientation.Orientation) =>
      o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
      o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
    // La rotación se dispara en el PRIMER frame. Antes se esperaba a que
    // resolviera getOrientationAsync() para recién ahí llamar a lockAsync: dos
    // viajes al lado nativo en serie, y el giro no empezaba hasta el segundo.
    // Ese retraso se pagaba entero detrás del overlay negro, en cada entrada al
    // reproductor. La consulta del estado actual sólo sirve para el caso "ya
    // estábamos en landscape", así que va en paralelo y no bloquea nada.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    ScreenOrientation.getOrientationAsync().then((cur) => {
      if (isLandscape(cur)) finish()
    })
    const sub = ScreenOrientation.addOrientationChangeListener((e) => {
      if (isLandscape(e.orientationInfo.orientation)) finish()
    })
    const t = setTimeout(finish, 550)
    return () => { ScreenOrientation.removeOrientationChangeListener(sub); clearTimeout(t) }
  }, [])

  useEffect(() => {
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) }
  }, [])

  // El menú de calidad no aplica a un archivo ya descargado: no hay fuentes
  // alternativas que ofrecer. El hook las pide igual (no sabe de descargas), así
  // que acá simplemente no se muestran.
  const sources = localIsFile ? [] : src.sources
  const sourcesLoading = localIsFile ? false : src.sourcesLoading

  // Última posición conocida. El hook lleva la suya para el cambio de calidad;
  // acá hace falta una propia porque el salto a AirPlay la necesita leída.
  const lastPositionRef = useRef(0)
  function reportPosition(t: number) {
    lastPositionRef.current = t
    src.reportPosition(t)
  }

  // Fuente VLC/mkv + TV conectada por AirPlay → saltar a la vía HLS retomando
  // la posición actual (el master HLS lo castea AVPlayer). Ver castForceHls.
  function forceCastHls() {
    if (castForceHls) return
    setStartAtOverride(lastPositionRef.current)
    setCastForceHls(true)
  }

  // Cambiar de calidad lo maneja el hook (retoma desde la posición reportada).
  // Acá solo se suelta el override del cast, que si no pisaría el startAt nuevo
  // con una posición vieja.
  async function pickSource(i: number) {
    setStartAtOverride(null)
    await src.pickSource(i)
  }

  // El motor no pudo reproducir (URL muerta, señuelo que pasó el filtro del
  // servidor, un códec que este iPhone no decodifica). Antes esto iba directo a
  // la pantalla de error; ahora se excluye esa fuente y se prueba la siguiente,
  // igual que hace la TV. Solo cuando se agotan las fuentes se muestra el error.
  // Un archivo local no tiene fuente que excluir → cae directo al error.
  function handlePlaybackError(msg: string) {
    const message = msg || 'Error de reproducción'
    if (localUri) { src.setError(message); return }
    // Si la fuente llegó a reproducir algo, la siguiente retoma ahí. Si murió en
    // el arranque (posición ~0) NO se pisa el startAt: hay que conservar el
    // punto guardado del usuario, que es lo que el hook ya trae.
    if (lastPositionRef.current > 5) setStartAtOverride(lastPositionRef.current)
    src.onSourceFailed(src.info?.source ?? '', message)
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

  // Cambia de episodio SIN renavegar: mover episodeN alcanza para que el hook
  // re-resuelva (y traiga el progreso guardado del episodio nuevo). Solo hay que
  // soltar el override de posición, que es del episodio anterior.
  function playNextEpisode() {
    setShowNext(false)
    setStartAtOverride(null)
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
          <SymbolView name="film.stack" tintColor={colors.textMuted} style={styles.errIcon} />
          <Text style={styles.errText}>{friendlyError.title}</Text>
          <Text style={styles.errSub}>{friendlyError.detail}</Text>
          <View style={styles.errButtons}>
            <Touchable scaleTo={0.95} haptic="light" style={styles.retry} onPress={src.retry}>
              <SymbolView name="arrow.clockwise" tintColor="#000" style={styles.retryIcon} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Touchable>
            <Touchable scaleTo={0.95} haptic="light" style={styles.errBackBtn} onPress={exitToBack}>
              <Text style={styles.errBackText}>Volver</Text>
            </Touchable>
          </View>
        </View>
      ) : ready && useVlc && vlcUri ? (
        <VlcPlayer
          // La fuente entra en la key: al cambiar de calidad —o al caer a otra
          // fuente tras un fallo— hay que remontar el player, no solo cambiarle
          // la uri. El remonta resetea el guard de "ya arranqué" y deja que
          // vuelva a buscar startAt (ver handleLoad/startedRef).
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${src.pickedSource ?? 'auto'}-${src.excluded.length}-vlc`}
          uri={vlcUri}
          // Un archivo local no necesita Referer (y pasárselo confunde a VLC).
          referer={localIsFile ? '' : referer}
          srtCues={srtCues}
          subsDiagnosis={subsDiagnosis}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          audioLang={src.audioLang}
          hasLatinoAlternative={hasLatinoAlternative}
          onChangeAudioLang={src.changeAudioLang}
          sources={sources}
          sourcesLoading={sourcesLoading}
          activeSourceIndex={src.pickedSource}
          // Sin fuentes alternativas no se ofrece la pestaña (descarga local).
          onPickSource={localIsFile ? undefined : pickSource}
          // Sin fuente remota (descarga local) no hay HLS al que castear.
          onCast={localIsFile ? undefined : forceCastHls}
          onPosition={reportPosition}
          offsetKey={`${type}-${id}-${seasonN ?? 0}-${episodeN ?? 0}`}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onError={handlePlaybackError}
        />
      ) : ready && (!isVlcSource || castForceHls) && masterUrl ? (
        <NativePlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${src.excluded.length}-hls`}
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
          onError={handlePlaybackError}
        />
      ) : (
        // Carga mínima: solo un spinner centrado. Se ve bien en cualquier
        // orientación (no hay layout que reflowee al girar) — antes era una
        // pantalla completa posicionada para landscape que aparecía achatada en
        // vertical durante el giro y "bugueaba" todo.
        <View style={styles.loadingSpinnerWrap}>
          <ActivityIndicator color="#fff" size="large" />
          <Pressable style={styles.loadingBack} onPress={exitToBack} hitSlop={12}>
            <SymbolView name="chevron.left" tintColor={colors.text} style={styles.loadingBackIcon} />
          </Pressable>
        </View>
      )}

      {/* Cubre el reflow durante la rotación (entrada y salida): negro por encima
          de todo hasta que el giro asentó. Sin esto se ve el layout landscape
          achatado en un frame portrait mientras iOS gira la pantalla. */}
      {!oriented && <View pointerEvents="none" style={styles.orientationCover} />}
    </GestureHandlerRootView>
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
  // progressRef local: onFullscreenExit lo lee para la fracción vista. El
  // guardado (throttle + final al desmontar) lo maneja useProgressSaver.
  const progressRef = useRef({ time: 0, duration: 0 })
  const { report: reportProgress } = useProgressSaver(meta)
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
    reportProgress(currentTime, dur)
  })

  useEventListener(player, 'playToEnd', () => onEnded())

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
  return /\b(?:spa|esp|spanish|español|castellano)\b/i.test(t.label) || isLatinTrack(t)
}

// Español LATINO específicamente, no castellano. Se usa para preferirlo cuando
// el archivo trae los dos doblajes: pedir "latino" y recibir el de España es
// exactamente el error que se busca evitar.
// `es-419` es el código ISO estándar para español de Latinoamérica; `es-MX`,
// `es-AR` etc. también aparecen en archivos reales.
function isLatinTrack(t: TrackInfo): boolean {
  const lang = (t.lang ?? '').toLowerCase()
  if (/^(?:es|spa)[-_](?:419|mx|ar|co|cl|pe|ve|la)/.test(lang)) return true
  return /\b(?:latino|latinoamerican[oa]|lat|mex|419)\b/i.test(t.label)
}

function VlcPlayer({
  uri, referer, srtCues, subsDiagnosis, startAt, meta, hasNext, title, episodeLabel,
  audioLang, hasLatinoAlternative, onChangeAudioLang,
  sources, sourcesLoading, activeSourceIndex, onPickSource, onPosition,
  onCast,
  offsetKey,
  onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  srtCues: SrtCue[]
  // Vacío = hay subtítulo español. Si no, explica por qué falta (ver
  // downloadSpanishSubs); se muestra en el menú de subtítulos.
  subsDiagnosis: string
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
  // Presente = se puede castear esta fuente (hay HLS remoto al que saltar).
  // Ausente (descarga local) = no se muestra el botón de AirPlay.
  onCast?: () => void
  // Clave de persistencia del desfase de subtítulos (por título/episodio).
  offsetKey: string
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
  // progressRef local: lo usan seekTo, la detección de fin y la fracción vista.
  // El guardado (throttle + final al desmontar) lo maneja useProgressSaver.
  const progressRef = useRef({ time: 0, duration: 0 })
  const { report: reportProgress } = useProgressSaver(meta)
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
  // Gesture.Tap() está confirmado roto en este setup (ver comentario más abajo
  // en pinchGesture). El doble tap para seek NO debe mostrar el HUD completo,
  // solo el indicador ±10s — por eso mostrar el HUD desde oculto se difiere la
  // ventana de doble tap (ver handleVideoPress).
  const lastTap = useRef<{ time: number; side: 'left' | 'right' } | null>(null)
  // Mostrar el HUD desde oculto se DIFIERE la ventana de doble tap: si llega un
  // segundo toque (doble tap = seek), se cancela y el HUD nunca aparece.
  const pendingShow = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Preferencias de subtítulo (modo activo, estilo y sincronía) en @bmo/player,
  // compartidas con la TV. El hook trabaja con ids de pista en string; VLCKit
  // los da numéricos, así que se adaptan en los dos sentidos.
  //
  // El modo se auto-elige una sola vez y sin pisar la elección manual:
  //   1. El .srt externo, si llegó: lo dibujamos nosotros, así que el estilo se
  //      puede cambiar al instante.
  //   2. Si no hay .srt, una pista en español embebida en el propio MKV.
  const subtitleTracks = useMemo(
    () => textTracks.map((t) => ({ id: String(t.id), language: t.lang, label: t.label })),
    [textTracks]
  )
  const {
    subStyle, subOffset, subMode, chooseSubMode, changeSubStyle, bumpOffset,
  } = useSubtitlePrefs({ offsetKey, srtCues, subtitleTracks })

  // Id de pista nativa para VLCKit, o -1 cuando el subtítulo no es del archivo
  // (overlay externo o apagado). Number('external') sería NaN, de ahí el chequeo
  // explícito en vez de un cast.
  const isNativeSub = subMode !== 'external' && subMode !== 'none'
  const nativeTextTrack = isNativeSub ? Number(subMode) : -1

  // El offset se RESTA de la posición: con offset positivo hay que "mirar más
  // atrás" en las cues, o sea que el texto aparece más tarde.
  const activeCue = subMode === 'external' ? findActiveCue(srtCues, position - subOffset) : null

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
      if (pendingShow.current) clearTimeout(pendingShow.current)
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

  // Si ya hay una TV conectada por AirPlay (p. ej. desde el Centro de Control)
  // al montar esta fuente VLC, saltamos a HLS de una — sin esperar a que el
  // usuario toque el botón.
  useEffect(() => {
    if (onCast && isAirPlayConnected()) onCast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Tap simple = mostrar/ocultar controles; doble tap en la mitad izquierda/
  // derecha = retroceder/adelantar 10s. Comparten el mismo Pressable.
  //
  // Con el HUD VISIBLE, un toque lo oculta al instante (no hay ambigüedad). Con
  // el HUD OCULTO el toque es ambiguo (mostrar vs doble-tap-seek), así que
  // DIFERIMOS el "mostrar" la ventana de doble tap: si llega el segundo toque,
  // hacemos seek + hint y el HUD NUNCA aparece (sin el parpadeo de antes). El
  // costo es que mostrar el HUD desde oculto tiene ~280ms de espera — a cambio de
  // que el doble tap para adelantar/atrasar quede limpio, solo con el indicador.
  function handleVideoPress(e: GestureResponderEvent) {
    const side: 'left' | 'right' = e.nativeEvent.locationX < winWidth / 2 ? 'left' : 'right'
    const now = Date.now()
    const last = lastTap.current

    // Segundo toque del mismo lado dentro de la ventana → DOBLE TAP: seek + hint,
    // sin tocar el HUD (cancela el "mostrar" pendiente que dejó el primer toque).
    if (last && last.side === side && now - last.time < DOUBLE_TAP_MS) {
      lastTap.current = null
      if (pendingShow.current) { clearTimeout(pendingShow.current); pendingShow.current = null }
      skipBy(side === 'right' ? 10 : -10)
      showSeekHint(side)
      return
    }

    lastTap.current = { time: now, side }

    if (controlsVisible) {
      toggleControls() // → ocultar, al instante
    } else {
      // Oculto: esperar la ventana de doble tap antes de mostrar.
      if (pendingShow.current) clearTimeout(pendingShow.current)
      pendingShow.current = setTimeout(() => {
        pendingShow.current = null
        setControlsVisible(true)
        scheduleHide()
      }, DOUBLE_TAP_MS)
    }
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
    // Se mira el título Y el código de idioma (`language`, ISO 639): muchos MKV
    // no titulan las pistas pero sí las etiquetan, y antes esas se perdían.
    // Además se prefiere LATINO sobre castellano cuando el archivo trae las
    // dos — son doblajes distintos y pedir "latino" y recibir el de España es
    // justo lo que se quiere evitar.
    const asTrack = (t: { id: number; title?: string; language?: string }) =>
      ({ id: t.id, label: t.title ?? '', lang: t.language })
    const latinoTrack = audioLang === 'latino'
      ? (data.audioTracks.find((t) => isLatinTrack(asTrack(t)))
        ?? data.audioTracks.find((t) => isSpanishTrack(asTrack(t))))
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
    reportProgress(data.currentTime, data.seekableDuration)
  }

  function handleError(data: OnVideoErrorData) {
    onError(data.error.errorString || 'Error de reproducción')
  }

  function handleBuffer(data: OnBufferData) {
    setBuffering(data.isBuffering)
  }

  // Al desmontar → limpia el timer de gracia del seek (el progreso final lo
  // guarda useProgressSaver).
  useEffect(() => {
    return () => {
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
            selectedTextTrack={nativeTextTrack}
            onLoad={handleLoad}
            onProgress={handleProgress}
            onBuffer={handleBuffer}
            onError={handleError}
            onEnd={onEnded}
          />
          {activeCue && (
            // El `bottom` sale de la preferencia y NO se le suma insets.bottom:
            // en landscape forzado por lockAsync (no una rotación física real),
            // el safe-area-context a veces no vuelve a medir bien y arrastra el
            // inset de portrait — sumaba altura de más sin que se note por qué.
            <View
              pointerEvents="none"
              style={[
                styles.subtitleOverlay,
                {
                  bottom: SUBTITLE_POSITION_BOTTOM[subStyle.position],
                  // La opacidad va en el contenedor para que atenúe texto y
                  // fondo juntos (ver SUBTITLE_OPACITY_VALUE).
                  opacity: SUBTITLE_OPACITY_VALUE[subStyle.opacity],
                },
              ]}
            >
              <Text
                style={[
                  styles.subtitleText,
                  {
                    fontSize: SUBTITLE_FONT_SIZE[subStyle.size],
                    color: SUBTITLE_COLOR_CSS[subStyle.color],
                    backgroundColor: subStyle.background === 'semi' ? 'rgba(0,0,0,0.6)' : 'transparent',
                    textShadowColor: SUBTITLE_OUTLINE[subStyle.outline].color,
                    textShadowRadius: SUBTITLE_OUTLINE[subStyle.outline].radius,
                    textShadowOffset: { width: 0, height: SUBTITLE_OUTLINE[subStyle.outline].offsetY },
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
            <View style={styles.vlcTopRight}>
              {/* AirPlay: la fuente VLC/mkv no castea; al conectar la TV
                  saltamos a la vía HLS (onCast → forceCastHls en PlayerScreen). */}
              {onCast && (
                <View style={styles.vlcIconBtn}>
                  <AirPlayButton
                    style={styles.airplayBtn}
                    tint="#FFFFFF"
                    activeTint={colors.accent}
                    onConnectionChange={(e) => { if (e.nativeEvent.connected) onCast() }}
                  />
                </View>
              )}
              {!buffering && (
                <Touchable
                  scaleTo={0.9} haptic="light" style={styles.vlcIconBtn}
                  onPress={() => setTrackPicker((p) => (p ? null : 'audio'))}
                >
                  <SymbolView name="ellipsis" tintColor="#fff" style={styles.vlcIcon} />
                </Touchable>
              )}
            </View>
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
            <Text style={styles.vlcTime}>{fmt(position)}</Text>
            <Slider
              style={styles.vlcSlider}
              value={position}
              minimumValue={0}
              maximumValue={duration > 0 ? duration : 1}
              minimumTrackTintColor="#fff"
              maximumTrackTintColor={colors.textFaint}
              thumbTintColor="#fff"
              onSlidingStart={() => { seeking.current = true }}
              onSlidingComplete={(v) => { seekTo(v) }}
            />
            <Text style={styles.vlcTime}>{fmt(duration)}</Text>
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
                colors={[colors.border, 'rgba(255,255,255,0)']}
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

              {/* La fila se muestra SIEMPRE. Antes dependía de
                  hasLatinoAlternative, que el servidor deduce del nombre de
                  archivo — si el release no dice "latino" en el título pero sí
                  trae el doblaje, la opción desaparecía y no había forma de
                  intentarlo. Es preferible ofrecerla y avisar si no se
                  encontró, a esconderla por una corazonada. */}
              {trackPicker === 'audio' && (
                <>
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
                    {/* hasLatinoAlternative ya no decide si la fila se ve, pero
                        sigue sirviendo para el texto: cuando el servidor SÍ
                        detectó una versión latina se promete algo concreto en
                        vez de un "buscar" que puede no encontrar nada. */}
                    <Text style={styles.vlcPickerSwitchText} numberOfLines={1}>
                      {audioLang === 'latino'
                        ? 'Volver a audio Original'
                        : hasLatinoAlternative
                          ? 'Cambiar a fuente con audio Latino'
                          : 'Buscar fuente con audio Latino'}
                    </Text>
                  </Touchable>

                  {/* Aviso honesto: se pidió latino pero el archivo que llegó
                      no trae ninguna pista en español. Sin esto el usuario
                      creía que había cambiado y seguía escuchando inglés. */}
                  {audioLang === 'latino' && audioTracks.length > 0
                    && !audioTracks.some(isSpanishTrack) && (
                    <Text style={styles.vlcPickerNotice}>
                      Esta fuente no trae audio en español. Prueba con otra en la pestaña de calidad.
                    </Text>
                  )}
                </>
              )}

              {trackPicker === 'style' ? (
                // ScrollView y no un View centrado: la tarjeta tiene alto fijo
                // (dropdownHeight) y con `justifyContent: center` el contenido
                // que no entraba desbordaba hacia ARRIBA y abajo a la vez,
                // montándose sobre las pestañas.
                <ScrollView
                  style={styles.vlcPickerList}
                  contentContainerStyle={styles.vlcStyleContent}
                  showsVerticalScrollIndicator={false}
                >
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
                  <SubtitleStyleRow
                    label="Borde"
                    value={subStyle.outline}
                    options={[
                      { value: 'none', label: 'Ninguno' },
                      { value: 'soft', label: 'Suave' },
                      { value: 'strong', label: 'Fuerte' },
                    ]}
                    onChange={(outline) => changeSubStyle({ outline })}
                  />
                  <SubtitleStyleRow
                    label="Posición"
                    value={subStyle.position}
                    options={[
                      { value: 'low', label: 'Abajo' },
                      { value: 'mid', label: 'Medio' },
                      { value: 'high', label: 'Alto' },
                    ]}
                    onChange={(position) => changeSubStyle({ position })}
                  />
                  <SubtitleStyleRow
                    label="Opacidad"
                    value={subStyle.opacity}
                    options={[
                      { value: 'full', label: '100%' },
                      { value: 'high', label: '85%' },
                      { value: 'medium', label: '70%' },
                    ]}
                    onChange={(opacity) => changeSubStyle({ opacity })}
                  />

                  {/* Sincronía. Los .srt vienen cronometrados para otro release
                      que el archivo que sirve Real-Debrid, así que casi siempre
                      hay un desfase; suelen ir adelantados. Se guarda por
                      título/episodio porque depende del archivo concreto. */}
                  <View style={styles.vlcSyncRow}>
                    <Text style={styles.vlcStyleLabel}>Sincronía</Text>
                    <View style={styles.vlcSyncControls}>
                      <Touchable
                        scaleTo={0.9} haptic="selection"
                        style={styles.vlcSyncBtn}
                        onPress={() => bumpOffset(-0.5)}
                      >
                        <Text style={styles.vlcSyncBtnText}>−0,5s</Text>
                      </Touchable>
                      <Touchable
                        scaleTo={0.92} haptic="light"
                        style={styles.vlcSyncValue}
                        onPress={() => bumpOffset(-subOffset)}
                      >
                        <Text style={styles.vlcSyncValueText}>
                          {subOffset === 0 ? '0s' : `${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)}s`}
                        </Text>
                      </Touchable>
                      <Touchable
                        scaleTo={0.9} haptic="selection"
                        style={styles.vlcSyncBtn}
                        onPress={() => bumpOffset(0.5)}
                      >
                        <Text style={styles.vlcSyncBtnText}>+0,5s</Text>
                      </Touchable>
                    </View>
                  </View>
                  <Text style={styles.vlcSyncHint}>
                    Si el texto va adelantado, sube el valor. Toca el número para volver a 0.
                  </Text>

                  {/* El estilo (y la sincronía) solo afectan al subtítulo que
                      descargamos y dibujamos nosotros. Las pistas incrustadas
                      en el archivo las renderiza VLCKit por dentro y no expone
                      control de apariencia — ver el comentario de
                      lib/subtitleStyle.ts. Se avisa en vez de dejar que el
                      usuario mueva controles que no hacen nada. */}
                  {isNativeSub && (
                    <Text style={styles.vlcPickerNotice}>
                      Estás viendo una pista incrustada en el archivo: estos ajustes solo
                      se aplican al subtítulo en español que descargamos.
                    </Text>
                  )}
                </ScrollView>
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
                        // Badge de idioma de la fuente (igual que en la TV): verde =
                        // latino/español (probable latino), ámbar = castellano
                        // (España, no lo que busca un usuario latino), gris = otros.
                        const lang = audioLangLabel(s.langs)
                        const tone =
                          lang === 'Latino' || lang === 'Español' ? 'es'
                          : lang === 'Castellano' ? 'cast'
                          : 'other'
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
                            {lang && (
                              <View style={[
                                styles.vlcLangBadge,
                                tone === 'es' ? styles.vlcLangBadgeEs : tone === 'cast' ? styles.vlcLangBadgeCast : styles.vlcLangBadgeOther,
                              ]}>
                                <Text style={[styles.vlcLangBadgeText, tone === 'other' ? styles.vlcLangBadgeTextOther : styles.vlcLangBadgeTextDark]}>
                                  {lang}
                                </Text>
                              </View>
                            )}
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
                        const selected = subMode === String(t.id)
                        return (
                          <Touchable
                            key={t.id}
                            scaleTo={0.98}
                            haptic="selection"
                            style={styles.vlcPickerRow}
                            onPress={() => { chooseSubMode(String(t.id)); setTrackPicker(null) }}
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
                      {/* Por qué falta el español. Se muestra aunque el archivo
                          traiga pistas propias: es justamente el caso confuso
                          —hay subtítulos, pero ninguno en español y sin poder
                          estilizar— y hasta ahora no se explicaba en ningún lado. */}
                      {srtCues.length === 0 && !!subsDiagnosis && (
                        <Text style={styles.vlcPickerEmpty}>{subsDiagnosis}</Text>
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
  // Tapa negra sobre todo mientras la pantalla rota (entrada/salida del player).
  orientationCover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 1000 },
  // Carga mínima: spinner centrado, orientación-agnóstico.
  loadingSpinnerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  loadingBack: { position: 'absolute', top: 50, left: 20, padding: 6 },
  loadingBackIcon: { width: 26, height: 26 },
  fill: { flex: 1, backgroundColor: '#000' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Pantalla de carga: minimalista — backdrop desenfocado + spinner chico + título.
  loadingRoot: { flex: 1, backgroundColor: '#000' },
  loadingScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40,
  },
  loadingTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  // top/right fijos y no insets: en el landscape forzado por lockAsync el
  // safe-area-context a veces arrastra los insets de portrait (mismo problema
  // ya documentado para la barra superior del VlcPlayer).
  loadingClose: {
    position: 'absolute', top: 16, right: 20,
    width: 34, height: 34, borderRadius: 17, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  loadingCloseBlur: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingCloseIcon: { width: 13, height: 13 },

  // Selector de idioma de audio: flotante, discreto, abajo del todo
  langSwitch: { position: 'absolute', left: 0, right: 0, bottom: 56, alignItems: 'center' },
  langSegmented: {
    flexDirection: 'row',
    borderRadius: 16, padding: 4, gap: 4,
    overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  langOption: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 9 },
  langOptionActive: { backgroundColor: '#fff' },
  langOptionText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
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
    // El contorno ya no vive acá: lo define subStyle.outline en el render.
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
  vlcTopRight: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  vlcIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  // AVRoutePickerView dibuja su propio glifo de AirPlay; lo centramos dentro
  // del botón circular para que combine con los demás íconos.
  airplayBtn: { width: 24, height: 24 },
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
    color: colors.textDim, fontSize: 13.5, fontWeight: '500', marginTop: 2,
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
    borderColor: colors.border,
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
  vlcQualitySub: { color: colors.textMuted, fontSize: 11.5 },
  // Badge de idioma de la fuente (mismos colores que la TV).
  vlcLangBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  vlcLangBadgeEs: { backgroundColor: colors.success },              // verde = latino / español (probable latino)
  vlcLangBadgeCast: { backgroundColor: '#FF9F0A' },            // ámbar = castellano (España)
  vlcLangBadgeOther: { backgroundColor: 'rgba(120,120,128,0.7)' }, // gris = otros idiomas
  vlcLangBadgeText: { fontSize: 12, fontWeight: '800' },
  vlcLangBadgeTextDark: { color: '#000' },
  vlcLangBadgeTextOther: { color: '#fff' },
  vlcPickerTab: {
    paddingVertical: 9, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  vlcPickerTabActive: { backgroundColor: '#fff' },
  vlcIconSm: { width: 16, height: 16 },
  vlcPickerSwitchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 6,
    backgroundColor: colors.hairline, borderRadius: 14,
    borderWidth: 1, borderColor: colors.fill,
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
  vlcPickerRowText: { color: colors.text, fontSize: 15, flexShrink: 1 },
  vlcPickerRowTextActive: { color: '#fff', fontWeight: '700' },
  vlcPickerNotice: {
    color: colors.warning, fontSize: 12.5, lineHeight: 17,
    paddingHorizontal: 14, paddingBottom: 10, paddingTop: 2,
  },
  vlcPickerEmpty: {
    color: colors.textMuted, fontSize: 13, textAlign: 'center',
    paddingVertical: 20, paddingHorizontal: 12,
  },

  // Picker de "Estilo" de subtítulos — las etiquetas "flotan" con text-shadow
  // sutil (sin fondo propio, como si estuvieran suspendidas sobre el vidrio).
  // flex:1 + centrado: llena el mismo alto fijo que la lista de pistas.
  // Sin flex ni justifyContent: es el contentContainer de un ScrollView, así
  // que crece con el contenido y scrollea si no entra.
  vlcStyleContent: { paddingHorizontal: 4, paddingVertical: 14, gap: 16 },
  vlcStyleRow: { gap: 10 },
  vlcSyncRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 4,
  },
  vlcSyncControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vlcSyncBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: colors.hairline,
  },
  vlcSyncBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  vlcSyncValue: { minWidth: 58, alignItems: 'center', paddingVertical: 7 },
  vlcSyncValueText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  vlcSyncHint: {
    color: colors.textMuted, fontSize: 11.5, marginTop: 8, lineHeight: 16,
  },
  vlcStyleLabel: {
    color: colors.textDim, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1.1, paddingHorizontal: 4,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  vlcStyleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 4 },
  vlcStyleChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: colors.fill,
    borderWidth: 1, borderColor: colors.fill,
  },
  vlcStyleChipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  vlcStyleChipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  vlcStyleChipTextActive: { color: '#000', fontWeight: '700' },

  errIcon: { width: 48, height: 48 },
  errText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  errSub: { color: colors.textMuted, fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 28, lineHeight: 20 },
  errButtons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28 },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12,
  },
  retryIcon: { width: 15, height: 15 },
  retryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  errBackBtn: {
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.textFaint,
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
    color: colors.textDim,
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
    color: colors.textDim,
    fontSize: 16,
    marginBottom: 24,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
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
    borderColor: colors.textMuted,
  },
  backText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
