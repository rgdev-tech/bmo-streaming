import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, tmdb, type MediaItem, type StudioDetail } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { STUDIO_BRANDS } from '@bmo/core/studios'
import { FocusButton } from '@/bmo/FocusButton'
import { PosterRow } from '@/bmo/PosterRow'
import { colors, rowHeading, safe, screenTitle } from '@/bmo/theme'

export default function StudioScreen() {
  const router = useRouter()
  const { key } = useLocalSearchParams<{ key: string }>()
  const { data, loading, error } = useAsync<StudioDetail>(() => tmdb.studio(key), [key], `studio:${key}`)

  // Los colores de marca están del lado del cliente, no los manda el API.
  const brand = STUDIO_BRANDS.find((b) => b.key === key)

  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.push(`/title/${t}/${item.id}`)
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
        <Text style={styles.errorTitle}>No pude cargar el catálogo</Text>
        <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
      </View>
    )
  }

  // w1280 alcanza de sobra para un fondo en TVs de hasta 1080p ('original'
  // puede venir en 4K+ de TMDB — decodificarlo entero es memoria tirada en
  // Fire TV / Mi Box de 1-2GB).
  const hero = backdropUrl(data.hero, 'w1280')

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {hero && (
            <Image source={hero} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} cachePolicy="disk" />
          )}
          {/* Degradado con el color de la marca sobre la imagen: la tiñe lo
              suficiente para que se lea como "sección de Disney" y no como una
              película más, sin tapar del todo el fotograma. */}
          <LinearGradient
            colors={
              brand
                ? [`${brand.colors[0]}E6`, `${brand.colors[1]}CC`, colors.bg]
                : ['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.8)', colors.bg]
            }
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.headerContent}>
            <Text style={styles.name}>{brand?.name ?? data.name}</Text>
            <View style={styles.actions}>
              <FocusButton label="Volver" primary hasTVPreferredFocus onPress={() => router.back()} />
            </View>
          </View>
        </View>

        {!!data.popular?.length && (
          <PosterRow title="Populares" items={data.popular} onPressItem={openTitle} />
        )}
        {!!data.topRated?.length && (
          <PosterRow title="Mejor valoradas" items={data.topRated} onPressItem={openTitle} />
        )}
        {!!data.recent?.length && (
          <PosterRow title="Novedades" items={data.recent} onPressItem={openTitle} />
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
  header: { height: 210, justifyContent: 'flex-end', marginBottom: 18 },
  headerContent: { paddingHorizontal: safe.horizontal, paddingBottom: 22 },
  name: { ...screenTitle, marginBottom: 14 },
  actions: { flexDirection: 'row' },
  tail: { height: safe.bottom },
})
