import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import YoutubePlayer, { PLAYER_STATES, type YoutubeIframeRef } from 'react-native-youtube-iframe'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import { SymbolView } from 'expo-symbols'
import * as WebBrowser from 'expo-web-browser'
import { Touchable } from '@/components/Touchable'
import { colors } from '@/lib/theme'

// Los controles propios se esconden solos mientras reproduce, como en cualquier
// reproductor: el tráiler es la imagen, no la botonera.
const CONTROLS_TIMEOUT = 2600
const PROGRESS_TICK = 500

/**
 * Tráiler de YouTube reproducido DENTRO de la ficha, en el hueco del backdrop.
 *
 * Va por YouTube y no por expo-video porque TMDB sólo entrega la clave del
 * video, nunca un archivo reproducible: no hay URL que darle a un reproductor
 * nativo. Y va por react-native-youtube-iframe y no por una WebView a mano
 * porque montar el embed uno mismo falla con "Este video no está disponible"
 * (error 152) incluso en videos que sí son embebibles.
 *
 * El reproductor de YouTube va con `controls: false` y los controles los
 * dibujamos acá. No es capricho: la botonera de YouTube trae el título del
 * video, el nombre del canal, el botón de compartir y "Mirar en YouTube"
 * encimados sobre la imagen — dentro de una ficha se lee como un pedazo de otra
 * app pegado con cinta.
 *
 * La reproducción arranca por acción explícita del usuario (tocar "Tráiler") y
 * no sola al abrir la pantalla: el embed puede anteponer publicidad, y un
 * anuncio arrancando solo en la portada de una ficha es lo contrario de lo que
 * se busca acá.
 */
export function InlineTrailer({
  youtubeKey,
  width,
  height,
  onClose,
}: {
  youtubeKey: string
  width: number
  height: number
  onClose: () => void
}) {
  const player = useRef<YoutubeIframeRef>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT)
  }, [])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // Barra de progreso propia. Se consulta al reproductor en vez de llevar un
  // contador local: el buffering y los saltos harían que un contador se
  // desincronice de lo que realmente se ve.
  useEffect(() => {
    if (!ready || !playing) return
    const id = setInterval(async () => {
      try {
        const [t, d] = await Promise.all([
          player.current?.getCurrentTime(),
          player.current?.getDuration(),
        ])
        if (t != null && d) setProgress(Math.min(1, t / d))
      } catch {
        // el reproductor puede estar reiniciándose; el próximo tick reintenta
      }
    }, PROGRESS_TICK)
    return () => clearInterval(id)
  }, [ready, playing])

  function onState(state: PLAYER_STATES) {
    if (state === PLAYER_STATES.PLAYING) setPlaying(true)
    if (state === PLAYER_STATES.PAUSED) setPlaying(false)
    // Al terminar se vuelve al backdrop en vez de dejar la pantalla de
    // sugerencias de YouTube ocupando la portada de la ficha.
    if (state === PLAYER_STATES.ENDED) onClose()
  }

  function togglePlay() {
    revealControls()
    setPlaying((p) => !p)
  }

  // Hay tráilers que el dueño del canal marca como no embebibles: ahí no queda
  // nada que reintentar, sólo ofrecer verlo donde sí se puede.
  if (failed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Este tráiler no se puede reproducir aquí.</Text>
        <Touchable
          scaleTo={0.96}
          haptic="light"
          style={styles.fallbackBtn}
          onPress={() => WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${youtubeKey}`)}
        >
          <Text style={styles.fallbackBtnText}>Ver en YouTube</Text>
        </Touchable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* El player queda por debajo y sin recibir toques: todo lo que hace el
          usuario pasa por la capa de controles de abajo. Sin esto un toque
          llegaría al iframe y abriría el menú de YouTube. */}
      <View style={styles.playerLayer} pointerEvents="none">
        <YoutubePlayer
          ref={player}
          videoId={youtubeKey}
          height={height}
          width={width}
          play={playing}
          onReady={() => setReady(true)}
          onError={() => setFailed(true)}
          onChangeState={onState}
          initialPlayerParams={{
            // Sin botonera de YouTube: la dibujamos nosotros (ver arriba).
            controls: false,
            // Al terminar no sugiere videos de otros canales.
            rel: false,
          }}
          webViewProps={{
            allowsInlineMediaPlayback: true,
            // ESTO es lo que deja arrancar el video solo en iOS. Sin la
            // bandera, WKWebView exige un toque y el tráiler se quedaba en el
            // póster con el botón rojo de YouTube en el medio.
            mediaPlaybackRequiresUserAction: false,
            scrollEnabled: false,
          }}
          webViewStyle={styles.web}
        />
      </View>

      {/* Capa de interacción: un toque muestra/oculta controles y play/pausa. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay}>
        {!ready && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}

        {ready && (!playing || controlsVisible) && (
          <Animated.View
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(220)}
            style={styles.controls}
            pointerEvents="none"
          >
            <View style={styles.playPill}>
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
              <SymbolView
                name={playing ? 'pause.fill' : 'play.fill'}
                tintColor="#fff"
                style={styles.playIcon}
              />
            </View>
          </Animated.View>
        )}
      </Pressable>

      {/* Cerrar: arriba a la derecha, despejado del botón de volver. */}
      <Touchable scaleTo={0.9} haptic="light" style={styles.close} onPress={onClose}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <SymbolView name="xmark" tintColor="#fff" style={styles.closeIcon} />
      </Touchable>

      {/* Progreso: una línea fina al borde inferior. Alcanza para saber cuánto
          queda sin construir una barra de scrub que nadie usa en un tráiler. */}
      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', overflow: 'hidden' },
  playerLayer: { ...StyleSheet.absoluteFillObject },
  web: { backgroundColor: '#000', opacity: 0.99 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPill: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  playIcon: { width: 22, height: 22 },
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  closeIcon: { width: 13, height: 13 },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#000',
    paddingHorizontal: 32,
  },
  fallbackText: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
  fallbackBtn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  fallbackBtnText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
})
