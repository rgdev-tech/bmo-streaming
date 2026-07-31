import { useLocalSearchParams, Stack } from 'expo-router'
import { useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
} from 'react-native'
import { Image } from 'expo-image'
import {
  tmdb,
  profileUrl,
  type PersonDetails,
  type PersonCredit,
} from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { PersonSkeleton } from '@/components/Skeleton'
import { colors } from '@/lib/theme'

function dedupeSorted(credits: PersonCredit[], type: 'movie' | 'tv') {
  const seen = new Set<number>()
  return credits
    .filter((c) => {
      const mt = c.media_type ?? (c.name && !c.title ? 'tv' : 'movie')
      return mt === type && c.poster_path && !seen.has(c.id) && seen.add(c.id)
    })
    .sort(
      (a, b) =>
        ((b as { popularity?: number }).popularity ?? 0) -
        ((a as { popularity?: number }).popularity ?? 0)
    )
    .map((c) => ({ ...c, media_type: type }))
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading, error, refetch } = useAsync<PersonDetails>(
    () => tmdb.person(id),
    [id]
  )
  const [expanded, setExpanded] = useState(false)

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
        <PersonSkeleton />
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
            title="No pude cargar el perfil"
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
      <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic">
            <View style={styles.header}>
              {profileUrl(data.profile_path, 'h632') ? (
                <Image
                  source={profileUrl(data.profile_path, 'h632')}
                  style={styles.photo}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[styles.photo, styles.empty]}>
                  <Text style={styles.initials}>{data.name.charAt(0)}</Text>
                </View>
              )}
              <View style={styles.headerInfo}>
                <Text style={styles.name}>{data.name}</Text>
                {data.known_for_department ? (
                  <Text style={styles.meta}>{data.known_for_department}</Text>
                ) : null}
                {data.birthday ? (
                  <Text style={styles.meta}>
                    {data.birthday.slice(0, 4)}
                    {data.place_of_birth ? ` · ${data.place_of_birth}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>

            {data.biography ? (
              <Touchable scaleTo={0.98} onPress={() => setExpanded((e) => !e)} style={styles.bioWrap}>
                <Text style={styles.bio} numberOfLines={expanded ? undefined : 4}>
                  {data.biography}
                </Text>
              </Touchable>
            ) : null}

            <View style={styles.rows}>
              <PosterRow
                title="Películas"
                items={dedupeSorted(data.combined_credits.cast, 'movie')}
              />
              <PosterRow
                title="Series"
                items={dedupeSorted(data.combined_credits.cast, 'tv')}
              />
            </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', gap: 16, padding: 20, paddingTop: 12 },
  photo: { width: 110, height: 165, borderRadius: 12, backgroundColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textMuted, fontSize: 40, fontWeight: '700' },
  headerInfo: { flex: 1, justifyContent: 'center' },
  name: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  meta: { color: colors.textMuted, fontSize: 14, marginTop: 6 },
  bioWrap: { paddingHorizontal: 20, paddingBottom: 8 },
  bio: { color: colors.text, fontSize: 15, lineHeight: 22 },
  rows: { paddingTop: 16, paddingBottom: 24 },
  errorFill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
})
