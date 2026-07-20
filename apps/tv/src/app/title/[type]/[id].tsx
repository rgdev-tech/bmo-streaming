import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import {
  backdropUrl,
  certificationOf,
  titleOf,
  tmdb,
  yearOf,
  type MediaDetails,
} from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { isInMyList, toggleMyList, toLibraryItem } from '@bmo/core/library'
import { FocusButton } from '@/bmo/FocusButton'
import { PosterRow } from '@/bmo/PosterRow'
import { colors, heroOverview, heroTitle, rowHeading, safe } from '@/bmo/theme'

export default function TitleScreen() {
  const router = useRouter()
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>()
  const isTv = type === 'tv'
  const { height } = useWindowDimensions()

  const { data, loading, error } = useAsync<MediaDetails>(
    () => (isTv ? tmdb.tv(id) : tmdb.movie(id)),
    [type, id]
  )

  const [inList, setInList] = useState(false)
  useEffect(() => {
    isInMyList(Number(id), isTv ? 'tv' : 'movie').then(setInList)
  }, [id, isTv])

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
  const backdrop = backdropUrl(data.backdrop_path, 'original')
  const heroHeight = Math.round(height * 0.62)

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
            <Text style={styles.title} numberOfLines={2}>
              {titleOf(data)}
            </Text>

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
                label={isTv ? 'Ver T1:E1' : 'Reproducir'}
                primary
                hasTVPreferredFocus
                onPress={() =>
                  router.push({
                    pathname: '/player',
                    params: {
                      type: isTv ? 'tv' : 'movie',
                      id,
                      title: titleOf(data),
                      poster: data.poster_path ?? '',
                      backdrop: data.backdrop_path ?? '',
                      ...(isTv ? { season: '1', episode: '1' } : {}),
                    },
                  })
                }
              />
              <FocusButton
                label={inList ? '✓ En Mi Lista' : '+ Mi Lista'}
                onPress={onToggleList}
              />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {!!data.genres?.length && (
            <Text style={styles.genres}>
              {data.genres.map((g) => g.name).join('  ·  ')}
            </Text>
          )}

          {!!data.credits?.cast?.length && (
            <View style={styles.castBlock}>
              <Text style={styles.sectionHeading}>Reparto</Text>
              <Text style={styles.cast} numberOfLines={2}>
                {data.credits.cast.slice(0, 8).map((c) => c.name).join('  ·  ')}
              </Text>
            </View>
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
  meta: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDim,
    marginBottom: 12,
  },
  overview: { ...heroOverview, marginBottom: 18 },
  actions: { flexDirection: 'row', gap: 12 },
  body: { paddingTop: 4 },
  genres: {
    fontSize: 13,
    color: colors.textDim,
    paddingHorizontal: safe.horizontal,
    marginBottom: 18,
  },
  castBlock: { paddingHorizontal: safe.horizontal, marginBottom: 26 },
  sectionHeading: { ...rowHeading, marginBottom: 6 },
  cast: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
})
