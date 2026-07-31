import { useLocalSearchParams, Stack, useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
  FadeIn,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { tmdb, backdropUrl, logoUrl, titleOf, yearOf, isReleased, trailerKey, certificationOf, type MediaDetails } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { SeasonEpisodes } from '@/components/SeasonEpisodes'
import { CastRow } from '@/components/CastRow'
import { PosterRow } from '@/components/PosterRow'
import { isInMyList, toggleMyList, toLibraryItem, getResumePoint } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { DownloadButton } from '@/components/DownloadButton'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { TitleSkeleton } from '@/components/Skeleton'
import { InlineTrailer } from '@/components/InlineTrailer'
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const HERO_H = width * 0.95
// Un tráiler es 16:9. Si se reproduce dentro del hero (que es casi cuadrado, a
// medida del póster) quedaba una franja negra enorme debajo del video. Con el
// tráiler abierto el hero se encoge a la altura exacta del video y el cuerpo de
// la ficha sube a ocupar el lugar.
const TRAILER_H = Math.round((width * 9) / 16)
// El hero se considera "consumido" un poco antes de terminar de salir: la barra
// superior tiene que estar sólida ANTES de que el fondo que queda detrás sea
// texto, no cuando ya se solapó.
const HEADER_FADE_START = HERO_H * 0.55
const HEADER_FADE_END = HERO_H * 0.8

export default function TitleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>()
  const isTv = type === 'tv'

  function play() {
    router.push({
      pathname: '/player',
      params: {
        type: isTv ? 'tv' : 'movie',
        id,
        title: data ? titleOf(data) : '',
        poster: data?.poster_path ?? '',
        backdrop: data?.backdrop_path ?? '',
        ...(isTv ? { season: '1', episode: '1' } : {}),
      },
    })
  }

  const { data, loading, error, refetch } = useAsync<MediaDetails>(
    () => (isTv ? tmdb.tv(id) : tmdb.movie(id)),
    [type, id]
  )

  const [inList, setInList] = useState(false)
  useEffect(() => {
    isInMyList(Number(id), isTv ? 'tv' : 'movie').then(setInList)
  }, [id, isTv])

  // Punto de retomar de la serie. Se recalcula al volver a esta pantalla
  // (useFocusEffect) porque lo normal es llegar acá justo después de ver algo.
  const [resume, setResume] = useState<{ season: number; episode: number; fresh: boolean } | null>(null)
  useFocusEffect(useCallback(() => {
    if (!isTv) return
    let alive = true
    getResumePoint(Number(id)).then((p) => {
      if (!alive) return
      // Sin historial se ofrece el primer episodio: el botón debe existir
      // igual, si no la serie no tiene forma obvia de empezar.
      setResume(p ?? { season: 1, episode: 1, fresh: true })
    })
    return () => { alive = false }
  }, [id, isTv]))

  function playResume() {
    if (!resume) return
    router.push({
      pathname: '/player',
      params: {
        type: 'tv',
        id,
        season: String(resume.season),
        episode: String(resume.episode),
        title: `${data ? titleOf(data) : ''} · T${resume.season}:E${resume.episode}`,
        poster: data?.poster_path ?? '',
        backdrop: data?.backdrop_path ?? '',
      },
    })
  }

  // Respaldo: si se llegó acá sin pasar por una tarjeta con prewarm-on-touch
  // (deep link, back/forward), igual precalienta apenas monta la pantalla.
  // Normalmente esto ya corrió antes, en el onPressIn de la tarjeta que trajo
  // hasta acá — ver prewarmTitle en lib/stream.ts.
  useEffect(() => {
    prewarmTitle(Number(id), isTv)
  }, [id, isTv])

  const [logo, setLogo] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    tmdb
      .logo(isTv ? 'tv' : 'movie', Number(id))
      .then((r) => !cancelled && setLogo(logoUrl(r.logo)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, isTv])

  async function onToggleList() {
    if (!data) return
    const added = await toggleMyList(toLibraryItem({ ...data, media_type: isTv ? 'tv' : 'movie' }))
    setInList(added)
  }

  const certification = data ? certificationOf(data) : null
  const trailer = trailerKey(data?.videos?.results)

  // El tráiler ocupa el hueco del backdrop en el propio hero. Se apaga al
  // cambiar de título para no dejar sonando el video del anterior.
  const [trailerOpen, setTrailerOpen] = useState(false)
  useEffect(() => { setTrailerOpen(false) }, [id, type])

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  function openTrailer() {
    setTrailerOpen(true)
    // Si el usuario ya había bajado, el hero está fuera de vista: sin esto el
    // tráiler arrancaría arriba de todo, donde no se ve.
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  // ── Scroll compartido con el hilo de UI ───────────────────────────────────
  // Todo el parallax y el header viven en useAnimatedStyle: corren en el hilo
  // de UI, así que no se entrecortan aunque el JS esté ocupado resolviendo la
  // ficha, bajando el logo o midiendo episodios.
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })

  // El hero cambia de alto según haya tráiler o no. Va animado para que el
  // cuerpo de la ficha suba acompañando al video en vez de dar un salto.
  const heroBoxStyle = useAnimatedStyle(() => ({
    height: withTiming(trailerOpen ? TRAILER_H : HERO_H, { duration: 280 }),
  }), [trailerOpen])

  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value
    return {
      transform: [
        // Al tirar hacia abajo (y < 0) la imagen crece desde su borde superior
        // en vez de dejar un hueco negro: es el "estirón" de las fichas de
        // Apple TV/Music. Al subir, se desplaza a la mitad de la velocidad del
        // scroll — eso es el parallax.
        { translateY: y < 0 ? 0 : y * 0.5 },
        { scale: y < 0 ? 1 + (-y / HERO_H) : 1 },
      ],
    }
  })

  // El bloque de logo/metadatos se va antes que la imagen: se desvanece y sube
  // un poco, así el hero se "vacía" en vez de arrastrar texto sobre el borde.
  const heroContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HERO_H * 0.45], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, HERO_H * 0.45], [0, -24], Extrapolation.CLAMP) },
    ],
  }))

  // Barra superior: aparece recién cuando el hero ya casi salió de pantalla.
  const headerBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [HEADER_FADE_START, HEADER_FADE_END],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }))

  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [HEADER_FADE_START + 20, HEADER_FADE_END],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [HEADER_FADE_START + 20, HEADER_FADE_END],
          [8, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }))

  const hidden = { headerShown: false } as const

  // Barra propia (y no la nativa de expo-router) porque necesita reaccionar al
  // scroll cuadro a cuadro: las opciones de navegación se actualizan desde JS y
  // eso se ve a los saltos. El botón de volver va siempre visible, en una
  // pastilla de vidrio que lo despega del backdrop sin taparlo.
  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, headerBgStyle]}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.headerHairline} />
      </Animated.View>

      <View style={styles.headerRow}>
        <Touchable
          scaleTo={0.9}
          haptic="light"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <SymbolView name="chevron.left" tintColor="#fff" style={styles.backIcon} />
        </Touchable>

        <Animated.Text style={[styles.headerTitle, headerTitleStyle]} numberOfLines={1}>
          {data ? titleOf(data) : ''}
        </Animated.Text>

        {/* Espejo del botón de volver: mantiene el título centrado de verdad. */}
        <View style={styles.backButtonSpacer} />
      </View>
    </View>
  )

  if (loading) {
    return (
      <>
        <Stack.Screen options={hidden} />
        {header}
        <TitleSkeleton />
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={hidden} />
        {header}
        <View style={styles.errorFill}>
          <EmptyState
            icon="exclamationmark.triangle"
            title="No pude cargar el título"
            subtitle="Revisa tu conexión e intenta de nuevo."
            action={{ label: 'Reintentar', onPress: refetch }}
          />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={hidden} />
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.container}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        // Con el tráiler abierto el scroll se bloquea: mover la pantalla
        // mientras se reproduce dentro del hero se siente a la deriva, y además
        // sacaría el video de vista.
        scrollEnabled={!trailerOpen}
      >
        <Animated.View style={[styles.hero, heroBoxStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.heroLayer, heroStyle]}>
            {backdropUrl(data.backdrop_path, 'w1280') && (
              <Image
                source={backdropUrl(data.backdrop_path, 'w1280')}
                style={styles.heroBg}
                contentFit="cover"
                transition={250}
              />
            )}
          </Animated.View>

          {trailerOpen && trailer ? (
            <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
              <InlineTrailer
                youtubeKey={trailer}
                width={width}
                height={TRAILER_H}
                onClose={() => setTrailerOpen(false)}
              />
            </Animated.View>
          ) : (
            <>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.5)', '#000']}
                locations={[0, 0.7, 1]}
                style={styles.heroGradient}
                pointerEvents="none"
              />
              <Animated.View style={[styles.heroContent, heroContentStyle]} pointerEvents="none">
                {logo ? (
                  <Image source={logo} style={styles.logo} contentFit="contain" transition={300} />
                ) : (
                  <Text style={styles.title} numberOfLines={2}>
                    {titleOf(data)}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  {yearOf(data) ? <Text style={styles.meta}>{yearOf(data)}</Text> : null}
                  {certification ? (
                    <View style={styles.certBadge}>
                      <Text style={styles.certText}>{certification}</Text>
                    </View>
                  ) : null}
                  {data.vote_average ? (
                    <Text style={styles.meta}>★ {data.vote_average.toFixed(1)}</Text>
                  ) : null}
                  {isTv && data.number_of_seasons ? (
                    <Text style={styles.meta}>{data.number_of_seasons} temp.</Text>
                  ) : null}
                  {data.runtime ? <Text style={styles.meta}>{data.runtime} min</Text> : null}
                </View>
              </Animated.View>
            </>
          )}
        </Animated.View>

        <View style={styles.body}>
          {!isTv &&
            (!isReleased(data.release_date) ? (
              <View style={styles.soonButton}>
                <SymbolView name="clock" tintColor={colors.textDim} style={styles.playIcon} />
                <Text style={styles.soonText}>
                  Próximamente{data.release_date ? ` · ${yearOf(data)}` : ''}
                </Text>
              </View>
            ) : (
              <Touchable scaleTo={0.97} haptic="medium" style={styles.playButton} onPress={play}>
                <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
                <Text style={styles.playText}>Reproducir</Text>
              </Touchable>
            ))}

          {/* Series: retomar donde iba. Se muestra siempre —con "Ver T1:E1" si
              nunca vio nada— para que exista un punto de entrada obvio sin
              tener que bajar hasta la lista de episodios y elegir a mano. */}
          {isTv && resume && (
            <Touchable scaleTo={0.97} haptic="medium" style={styles.playButton} onPress={playResume}>
              <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
              <Text style={styles.playText}>
                {resume.fresh ? 'Ver' : 'Continuar'} T{resume.season}:E{resume.episode}
              </Text>
            </Touchable>
          )}

          {/* Cada botón va dentro de un "slot" con flex:1 y NO con el flex en
              el propio Touchable: Touchable aplica su `style` a un
              Animated.View interno, así que el flex caía en el nieto y el
              Pressable se dimensionaba por su contenido. Resultado: los tres
              no repartían el ancho y "Tráiler" se salía de la pantalla.
              (Se notaba en que "Descargar" sí funcionaba: ese es un View
              normal, no un Touchable.) */}
          <View style={styles.secondaryRow}>
            <View style={styles.secondarySlot}>
              <Touchable scaleTo={0.95} haptic="light" style={styles.secondaryBtn} onPress={onToggleList}>
                <SymbolView
                  name={inList ? 'checkmark' : 'plus'}
                  tintColor="#fff"
                  style={styles.listIcon}
                />
                <Text style={styles.listText} numberOfLines={1}>Mi Lista</Text>
              </Touchable>
            </View>
            {!isTv && data && isReleased(data.release_date) && (
              <View style={styles.secondarySlot}>
                <View style={styles.secondaryBtn}>
                  <DownloadButton
                    id={Number(id)}
                    media_type="movie"
                    title={titleOf(data)}
                    poster_path={data.poster_path}
                    backdrop_path={data.backdrop_path}
                    size={19}
                  />
                  <Text style={styles.listText} numberOfLines={1}>Descargar</Text>
                </View>
              </View>
            )}
            {trailer && (
              <View style={styles.secondarySlot}>
                <Touchable
                  scaleTo={0.95}
                  haptic="light"
                  style={[styles.secondaryBtn, trailerOpen && styles.secondaryBtnActive]}
                  onPress={() => (trailerOpen ? setTrailerOpen(false) : openTrailer())}
                >
                  <SymbolView
                    name={trailerOpen ? 'stop.fill' : 'play.rectangle'}
                    tintColor={trailerOpen ? colors.onAccent : '#fff'}
                    style={styles.listIcon}
                  />
                  <Text
                    style={[styles.listText, trailerOpen && styles.listTextActive]}
                    numberOfLines={1}
                  >
                    Tráiler
                  </Text>
                </Touchable>
              </View>
            )}
          </View>

          {data.genres?.length ? (
            <Text style={styles.genres}>
              {data.genres.map((g) => g.name).join(' · ')}
            </Text>
          ) : null}

          <Text style={styles.overview}>{data.overview || 'Sin sinopsis.'}</Text>

          {isTv && data.seasons?.length ? (
            <SeasonEpisodes
              tvId={id}
              title={titleOf(data)}
              seasons={data.seasons}
              poster={data.poster_path}
              backdrop={data.backdrop_path}
            />
          ) : null}

          {data.credits?.cast?.length ? (
            <CastRow cast={data.credits.cast} />
          ) : null}
        </View>

        {data.similar?.results?.length ? (
          <View style={styles.similar}>
            <PosterRow title="Similares" items={data.similar.results} />
          </View>
        ) : null}
      </Animated.ScrollView>

      {header}
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Sin `height`: lo pone heroBoxStyle, que lo anima entre el alto de portada y
  // el 16:9 del tráiler.
  hero: {
    width,
    backgroundColor: colors.surface,
    // La imagen escalada no debe pasarse al cuerpo de la ficha.
    overflow: 'hidden',
  },
  // El estirón al tirar hacia abajo crece desde el borde de arriba; sin esto
  // escalaría desde el centro y despegaría la imagen del tope de la pantalla.
  // Va en la capa que realmente lleva el transform, no en el contenedor.
  heroLayer: { transformOrigin: 'top center' },
  heroBg: { ...StyleSheet.absoluteFillObject },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  heroContent: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  logo: { width: width * 0.7, height: 84 },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  headerHairline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginHorizontal: 8,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  backButtonSpacer: { width: 34, height: 34 },
  backIcon: { width: 15, height: 15 },

  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  metaRow: { flexDirection: 'row', gap: 14, marginTop: 10, justifyContent: 'center' },
  meta: { color: colors.textDim, fontSize: 14, fontWeight: '500' },
  certBadge: {
    borderWidth: 1,
    borderColor: colors.textMuted,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  certText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
  },
  soonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.hairline,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
  },
  soonText: { color: colors.textDim, fontSize: 16, fontWeight: '600' },
  playIcon: { width: 16, height: 16 },
  playText: { color: '#000', fontSize: 16, fontWeight: '700' },
  secondaryRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  // El reparto del ancho vive acá, no en secondaryBtn (ver el comentario del JSX).
  secondarySlot: { flex: 1 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: colors.fill,
  },
  // Con el tráiler sonando el botón queda encendido: es el mismo control que lo
  // apaga, así que tiene que leerse como "activo" y no como uno más.
  secondaryBtnActive: { backgroundColor: colors.accent },
  listIcon: { width: 17, height: 17 },
  // 14 y no 15: con tres botones e icono, "Descargar" quedaba al filo en
  // pantallas de 390pt.
  listText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  listTextActive: { color: colors.onAccent },
  genres: { color: colors.textMuted, fontSize: 13, marginTop: 20 },
  overview: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  similar: { marginTop: 8, marginBottom: 24 },
  errorFill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
})
