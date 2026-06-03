import { useLocalSearchParams, Stack, useRouter } from 'expo-router'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import { tmdb, backdropUrl, titleOf, yearOf, type MediaDetails } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'

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
        ...(isTv ? { season: '1', episode: '1' } : {}),
      },
    })
  }

  const { data, loading, error } = useAsync<MediaDetails>(
    () => (isTv ? tmdb.tv(id) : tmdb.movie(id)),
    [type, id]
  )

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
            {backdropUrl(data.backdrop_path) && (
              <Image
                source={backdropUrl(data.backdrop_path)}
                style={styles.backdrop}
                contentFit="cover"
                transition={250}
              />
            )}

            <View style={styles.body}>
              <Text style={styles.title}>{titleOf(data)}</Text>

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

              <Pressable style={styles.playButton} onPress={play}>
                <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
                <Text style={styles.playText}>
                  {isTv ? 'Reproducir T1:E1' : 'Reproducir'}
                </Text>
              </Pressable>

              {data.genres?.length ? (
                <Text style={styles.genres}>
                  {data.genres.map((g) => g.name).join(' · ')}
                </Text>
              ) : null}

              <Text style={styles.overview}>{data.overview || 'Sin sinopsis.'}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  backdrop: { width: '100%', height: 240, backgroundColor: '#1C1C1E' },
  body: { padding: 20 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  metaRow: { flexDirection: 'row', gap: 14, marginTop: 8 },
  meta: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500' },
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
  playIcon: { width: 16, height: 16 },
  playText: { color: '#000', fontSize: 16, fontWeight: '700' },
  genres: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 20 },
  overview: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  spinner: { marginTop: 120 },
  error: { color: '#FF6B6B', textAlign: 'center', marginTop: 120 },
})
