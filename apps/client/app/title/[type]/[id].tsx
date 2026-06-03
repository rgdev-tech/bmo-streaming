import { useLocalSearchParams, Stack, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import * as WebBrowser from 'expo-web-browser'
import { tmdb, backdropUrl, logoUrl, titleOf, yearOf, isReleased, trailerKey, type MediaDetails } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { SeasonEpisodes } from '@/components/SeasonEpisodes'
import { CastRow } from '@/components/CastRow'
import { PosterRow } from '@/components/PosterRow'
import { isInMyList, toggleMyList, toLibraryItem } from '@/lib/library'

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

  const { data, loading, error } = useAsync<MediaDetails>(
    () => (isTv ? tmdb.tv(id) : tmdb.movie(id)),
    [type, id]
  )

  const [inList, setInList] = useState(false)
  useEffect(() => {
    isInMyList(Number(id), isTv ? 'tv' : 'movie').then(setInList)
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

  const trailer = trailerKey(data?.videos?.results)
  function openTrailer() {
    if (trailer) WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${trailer}`)
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTransparent: true,
          headerBlurEffect: 'dark',
          title: '',
          headerTintColor: '#fff',
        }}
      />
      <ScrollView style={styles.container}>
        {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}
        {error && <Text style={styles.error}>No pude cargar el título.</Text>}

        {data && (
          <>
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
                (isReleased(data.release_date) ? (
                  <Pressable style={styles.playButton} onPress={play}>
                    <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
                    <Text style={styles.playText}>Reproducir</Text>
                  </Pressable>
                ) : (
                  <View style={styles.soonButton}>
                    <SymbolView name="clock" tintColor="rgba(255,255,255,0.7)" style={styles.playIcon} />
                    <Text style={styles.soonText}>
                      Próximamente{data.release_date ? ` · ${yearOf(data)}` : ''}
                    </Text>
                  </View>
                ))}

              <View style={styles.secondaryRow}>
                <Pressable style={styles.secondaryBtn} onPress={onToggleList}>
                  <SymbolView
                    name={inList ? 'checkmark' : 'plus'}
                    tintColor="#fff"
                    style={styles.listIcon}
                  />
                  <Text style={styles.listText}>Mi Lista</Text>
                </Pressable>
                {trailer && (
                  <Pressable style={styles.secondaryBtn} onPress={openTrailer}>
                    <SymbolView name="play.rectangle" tintColor="#fff" style={styles.listIcon} />
                    <Text style={styles.listText}>Tráiler</Text>
                  </Pressable>
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
          </>
        )}
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
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  listIcon: { width: 18, height: 18 },
  listText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  genres: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 20 },
  overview: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  similar: { marginTop: 8, marginBottom: 24 },
  spinner: { marginTop: 120 },
  error: { color: '#FF6B6B', textAlign: 'center', marginTop: 120 },
})
