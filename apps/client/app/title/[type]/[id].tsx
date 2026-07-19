import { useLocalSearchParams, Stack, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import * as WebBrowser from 'expo-web-browser'
import { tmdb, backdropUrl, logoUrl, titleOf, yearOf, isReleased, trailerKey, certificationOf, type MediaDetails } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { SeasonEpisodes } from '@/components/SeasonEpisodes'
import { CastRow } from '@/components/CastRow'
import { PosterRow } from '@/components/PosterRow'
import { isInMyList, toggleMyList, toLibraryItem } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { DownloadButton } from '@/components/DownloadButton'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { TitleSkeleton } from '@/components/Skeleton'

export default function TitleScreen() {
  const router = useRouter()
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
  function openTrailer() {
    if (trailer) WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${trailer}`)
  }

  const screenOptions = {
    headerTransparent: true,
    headerBlurEffect: 'dark' as const,
    title: '',
    headerTintColor: '#fff',
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={screenOptions} />
        <TitleSkeleton />
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <Stack.Screen options={screenOptions} />
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
      <Stack.Screen options={screenOptions} />
      <ScrollView style={styles.container}>
        <View style={styles.hero}>
          {backdropUrl(data.backdrop_path, 'w1280') && (
            <Image
              source={backdropUrl(data.backdrop_path, 'w1280')}
              style={styles.heroBg}
              contentFit="cover"
              transition={250}
            />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)', '#000']}
            locations={[0, 0.7, 1]}
            style={styles.heroGradient}
          />
          <View style={styles.heroContent}>
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
          </View>
        </View>

        <View style={styles.body}>
          {!isTv &&
            (!isReleased(data.release_date) ? (
              <View style={styles.soonButton}>
                <SymbolView name="clock" tintColor="rgba(255,255,255,0.7)" style={styles.playIcon} />
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
                <Touchable scaleTo={0.95} haptic="light" style={styles.secondaryBtn} onPress={openTrailer}>
                  <SymbolView name="play.rectangle" tintColor="#fff" style={styles.listIcon} />
                  <Text style={styles.listText} numberOfLines={1}>Tráiler</Text>
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
      </ScrollView>
    </>
  )
}

const { width } = Dimensions.get('window')
const HERO_H = width * 0.95

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  hero: { width, height: HERO_H, backgroundColor: '#1C1C1E' },
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
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  metaRow: { flexDirection: 'row', gap: 14, marginTop: 10, justifyContent: 'center' },
  meta: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  certBadge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  certText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
  },
  soonText: { color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: '600' },
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
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  listIcon: { width: 17, height: 17 },
  // 14 y no 15: con tres botones e icono, "Descargar" quedaba al filo en
  // pantallas de 390pt.
  listText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  genres: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 20 },
  overview: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  similar: { marginTop: 8, marginBottom: 24 },
  errorFill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
})
