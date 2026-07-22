import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { profileUrl, tmdb, type MediaItem, type PersonDetails } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { FocusButton } from '@/bmo/FocusButton'
import { PosterRow } from '@/bmo/PosterRow'
import { colors, rowHeading, safe, screenTitle } from '@/bmo/theme'

const PHOTO = 190

export default function PersonScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, loading, error } = useAsync<PersonDetails>(() => tmdb.person(id), [id], `person:${id}`)

  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.replace(`/title/${t}/${item.id}`)
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
        <Text style={styles.errorTitle}>No pude cargar la persona</Text>
        <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
      </View>
    )
  }

  const img = profileUrl(data.profile_path, 'h632')

  // Se ordena por popularidad y se quitan los que no tienen póster: la fila se
  // ve mal con huecos, y los créditos sin imagen suelen ser apariciones menores.
  const credits = (data.combined_credits?.cast ?? [])
    .filter((c) => c.poster_path)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))

  const meta = [
    data.known_for_department,
    data.birthday ? new Date(data.birthday).getFullYear() : null,
    data.place_of_birth,
  ].filter(Boolean)

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {img ? (
            <Image source={img} style={styles.photo} contentFit="cover" transition={200} />
          ) : (
            <View style={[styles.photo, styles.empty]}>
              <Text style={styles.initials}>{data.name.charAt(0)}</Text>
            </View>
          )}

          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={2}>
              {data.name}
            </Text>
            {!!meta.length && <Text style={styles.meta}>{meta.join('  ·  ')}</Text>}
            {!!data.biography && (
              // Cuatro líneas y corta: una biografía completa en una tele son
              // veinte líneas que nadie lee desde el sillón.
              <Text style={styles.bio} numberOfLines={4}>
                {data.biography}
              </Text>
            )}
            <View style={styles.actions}>
              <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
            </View>
          </View>
        </View>

        {!!credits.length && (
          <PosterRow title="También aparece en" items={credits} onPressItem={openTitle} />
        )}

        <View style={styles.tail} />
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
  header: {
    flexDirection: 'row',
    gap: 28,
    paddingHorizontal: safe.horizontal,
    paddingTop: safe.top,
    paddingBottom: 30,
  },
  photo: {
    width: PHOTO,
    height: PHOTO * 1.35,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textDim, fontSize: 56, fontWeight: '700' },
  info: { flex: 1, paddingTop: 6 },
  name: { ...screenTitle, marginBottom: 8 },
  meta: { fontSize: 14, fontWeight: '600', color: colors.textDim, marginBottom: 14 },
  bio: { fontSize: 14, color: colors.textDim, lineHeight: 21, marginBottom: 18, maxWidth: '86%' },
  actions: { flexDirection: 'row' },
  tail: { height: safe.bottom },
})
