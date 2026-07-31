import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Linking } from 'react-native'
import {
  backdropUrl,
  certificationOf,
  logoUrl,
  titleOf,
  tmdb,
  trailerKey,
  yearOf,
  type MediaDetails,
} from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { prewarmTitle } from '@bmo/core/stream'
import { getResumePoint, isInMyList, toggleMyList, toLibraryItem } from '@bmo/core/library'
import { FocusButton } from '@/bmo/FocusButton'
import { PosterRow } from '@/bmo/PosterRow'
import { CastRow } from '@/bmo/CastRow'
import { SeasonEpisodes } from '@/bmo/SeasonEpisodes'
import { colors, heroOverview, heroTitle, rowHeading, safe } from '@/bmo/theme'

export default function TitleScreen() {
  const router = useRouter()
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>()
  const isTv = type === 'tv'
  const { height } = useWindowDimensions()

  const { data, loading, error } = useAsync<MediaDetails>(
    () => (isTv ? tmdb.tv(id) : tmdb.movie(id)),
    [type, id],
    `title:${type}:${id}`
  )

  const [inList, setInList] = useState(false)
  useEffect(() => {
    isInMyList(Number(id), isTv ? 'tv' : 'movie').then(setInList)
  }, [id, isTv])

  // Punto de retomar de la serie. Se recalcula cada vez que se vuelve a esta
  // pantalla (no solo al montar) porque lo normal es llegar acá justo después
  // de haber visto un episodio, y el botón tiene que reflejarlo.
  const [resume, setResume] = useState<{ season: number; episode: number; fresh: boolean } | null>(
    null
  )
  useFocusEffect(
    useCallback(() => {
      if (!isTv) return
      let alive = true
      getResumePoint(Number(id)).then((p) => {
        if (!alive) return
        // Sin historial se ofrece el primer episodio: el botón tiene que existir
        // igual, si no la serie no tiene punto de entrada obvio.
        setResume(p ?? { season: 1, episode: 1, fresh: true })
      })
      return () => {
        alive = false
      }
    }, [id, isTv])
  )

  // Igual que en el Hero de la home: el logo es una petición aparte y muchos
  // títulos no tienen, así que el texto sigue siendo el caso normal, no el error.
  const [logo, setLogo] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLogo(null)
    tmdb
      .logo(isTv ? 'tv' : 'movie', Number(id))
      .then((r) => !cancelled && setLogo(logoUrl(r.logo)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, isTv])

  // Precalienta la fuente en segundo plano mientras el usuario está en la ficha:
  // el scraping (lo más lento del arranque) corre durante la lectura de la
  // sinopsis, así que al apretar Play el API ya tiene la fuente en caché y el
  // primer frame llega mucho antes. Igual que hace el cliente (teléfono).
  //  - Películas: en cuanto se conoce el título.
  //  - Series: recién cuando `resume` resolvió el episodio exacto a reproducir,
  //    para no precalentar S1E1 cuando en realidad va a retomar en otro.
  useEffect(() => {
    if (!isTv) { prewarmTitle(Number(id), false); return }
    if (resume) prewarmTitle(Number(id), true, resume.season, resume.episode)
  }, [id, isTv, resume])

  async function onToggleList() {
    if (!data) return
    const next = await toggleMyList(toLibraryItem(data))
    setInList(next)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    )
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>No pude cargar el título</Text>
        <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
      </View>
    )
  }

  const certification = certificationOf(data)
  // w1280 y no 'original': el panel es ~1920px, 'original' suele ser 3840px — un
  // decode ~4× más pesado en RAM, que en dispositivos con poca memoria (Fire TV
  // ~2GB) suma presión inútil justo antes de entrar al reproductor. Mismo criterio
  // que el Hero.
  const backdrop = backdropUrl(data.backdrop_path, 'w1280')
  const heroHeight = Math.round(height * 0.62)

  // Series: el botón refleja dónde quedó. "Ver" cuando nunca vio nada,
  // "Continuar" cuando hay historial — la palabra sola ya le dice al usuario si
  // la app se acuerda de él o no.
  const playLabel = !isTv
    ? 'Reproducir'
    : resume
      ? `${resume.fresh ? 'Ver' : 'Continuar'} T${resume.season}:E${resume.episode}`
      : 'Reproducir'

  function play() {
    const ep = isTv ? (resume ?? { season: 1, episode: 1 }) : null
    router.push({
      pathname: '/player',
      params: {
        type: isTv ? 'tv' : 'movie',
        id,
        title: ep ? `${titleOf(data!)} · T${ep.season}:E${ep.episode}` : titleOf(data!),
        poster: data!.poster_path ?? '',
        backdrop: data!.backdrop_path ?? '',
        ...(ep ? { season: String(ep.season), episode: String(ep.episode) } : {}),
      },
    })
  }

  const trailer = trailerKey(data.videos?.results)
  function openTrailer() {
    if (!trailer) return
    // Linking y no un navegador embebido: en Android TV muchos dispositivos no
    // traen navegador, pero sí la app de YouTube, y el intent la resuelve.
    // Si nada puede abrir la URL, se ignora en silencio en vez de romper.
    const url = `https://www.youtube.com/watch?v=${trailer}`
    Linking.canOpenURL(url)
      .then((ok) => ok && Linking.openURL(url))
      .catch(() => {})
  }

  // Chips de metadatos. Se arma como lista y se une con separadores para no
  // terminar con un "·" colgando cuando alguno de los campos viene vacío.
  const meta = [
    yearOf(data),
    certification,
    data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : null,
    isTv && data.number_of_seasons ? `${data.number_of_seasons} temp.` : null,
    data.runtime ? `${data.runtime} min` : null,
  ].filter(Boolean)

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { height: heroHeight }]}>
          {backdrop && (
            <Image
              source={backdrop}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
              cachePolicy="disk"
            />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', colors.bg]}
            locations={[0.3, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.88)', 'rgba(0,0,0,0.3)', 'transparent']}
            locations={[0, 0.5, 0.8]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.heroContent}>
            {logo ? (
              <Image
                source={logo}
                style={styles.logo}
                contentFit="contain"
                contentPosition="bottom left"
                transition={300}
              />
            ) : (
              <Text style={styles.title} numberOfLines={2}>
                {titleOf(data)}
              </Text>
            )}

            {!!meta.length && <Text style={styles.meta}>{meta.join('  ·  ')}</Text>}

            {!!data.overview && (
              <Text style={styles.overview} numberOfLines={3}>
                {data.overview}
              </Text>
            )}

            {/* hasTVPreferredFocus en Reproducir: al entrar a la ficha el foco
                tiene que caer solo en la acción principal. Sin esto el usuario
                aterriza sin foco visible y no sabe por dónde empezar. */}
            <View style={styles.actions}>
              <FocusButton
                label={playLabel}
                primary
                hasTVPreferredFocus
                onPress={play}
              />
              <FocusButton
                label={inList ? '✓ En Mi Lista' : '+ Mi Lista'}
                onPress={onToggleList}
              />
              {!!trailer && <FocusButton label="Tráiler" onPress={openTrailer} />}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Los géneros como pastillas y no como texto corrido: en el bloque
              de abajo compiten con los encabezados de sección, y una línea de
              texto suelta se lee como si fuera contenido en vez de etiquetas. */}
          {!!data.genres?.length && (
            <View style={styles.genres}>
              {data.genres.map((g) => (
                <View key={g.id} style={styles.genreChip}>
                  <Text style={styles.genreText}>{g.name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Series: episodios antes que reparto. Quien entra a la ficha de una
              serie casi siempre viene a elegir capítulo, no a mirar el elenco. */}
          {isTv && !!data.seasons?.length && (
            <SeasonEpisodes
              tvId={id}
              seasons={data.seasons}
              onPlayEpisode={(season, ep) =>
                router.push({
                  pathname: '/player',
                  params: {
                    type: 'tv',
                    id,
                    season: String(season),
                    episode: String(ep.episode_number),
                    title: `${titleOf(data)} · T${season}:E${ep.episode_number}`,
                    poster: data.poster_path ?? '',
                    backdrop: data.backdrop_path ?? '',
                  },
                })
              }
            />
          )}

          {!!data.credits?.cast?.length && (
            <CastRow
              cast={data.credits.cast}
              onPressPerson={(p) => router.push(`/person/${p.id}`)}
            />
          )}

          {!!data.similar?.results?.length && (
            <PosterRow
              title="Títulos similares"
              items={data.similar.results}
              onPressItem={(item) => {
                const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
                // replace y no push: encadenar fichas con push haría crecer el
                // stack sin límite y el botón atrás del control tendría que
                // recorrer toda la cadena para salir.
                router.replace(`/title/${t}/${item.id}`)
              }}
            />
          )}

          {/* Aire al final: sin esto la última fila queda pegada al borde y al
              enfocarla el scroll no tiene hacia dónde correrse. */}
          <View style={styles.tail} />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorTitle: rowHeading,
  hero: { width: '100%', backgroundColor: colors.bg },
  heroContent: {
    position: 'absolute',
    left: safe.horizontal,
    bottom: 30,
    maxWidth: '52%',
  },
  title: { ...heroTitle, marginBottom: 8 },
  // Mismo hueco que ocuparía el título en texto, para que los metadatos no
  // salten de posición según el título tenga logo o no.
  logo: { width: '100%', height: 72, marginBottom: 10 },
  meta: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDim,
    marginBottom: 12,
  },
  overview: { ...heroOverview, marginBottom: 18 },
  actions: { flexDirection: 'row', gap: 12 },
  body: { paddingTop: 6 },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: safe.horizontal,
    marginBottom: 26,
  },
  genreChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(120,120,128,0.24)',
  },
  genreText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  tail: { height: safe.bottom },
})
