import { useState } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { tmdb, stillUrl, type Season, type Episode } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'

export function SeasonEpisodes({
  tvId,
  title,
  seasons,
}: {
  tvId: string
  title: string
  seasons: Season[]
}) {
  // Solo temporadas reales (descarta "Especiales" = 0 y vacías)
  const real = seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)

  const [selected, setSelected] = useState(real[0]?.season_number ?? 1)
  const { data, loading } = useAsync(() => tmdb.season(tvId, selected), [selected])

  return (
    <View style={styles.wrap}>
      {/* Selector de temporada */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.seasonBar}
      >
        {real.map((s) => {
          const active = s.season_number === selected
          return (
            <Pressable
              key={s.id}
              onPress={() => setSelected(s.season_number)}
              style={[styles.seasonChip, active && styles.seasonChipActive]}
            >
              <Text style={[styles.seasonText, active && styles.seasonTextActive]}>
                Temporada {s.season_number}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}

      {data?.episodes.map((ep) => (
        <EpisodeRow
          key={ep.id}
          tvId={tvId}
          title={title}
          season={selected}
          ep={ep}
        />
      ))}
    </View>
  )
}

function EpisodeRow({
  tvId,
  title,
  season,
  ep,
}: {
  tvId: string
  title: string
  season: number
  ep: Episode
}) {
  const router = useRouter()
  const still = stillUrl(ep.still_path)

  return (
    <Pressable
      style={styles.epRow}
      onPress={() =>
        router.push({
          pathname: '/player',
          params: {
            type: 'tv',
            id: tvId,
            season: String(season),
            episode: String(ep.episode_number),
            title: `${title} · T${season}:E${ep.episode_number}`,
          },
        })
      }
    >
      <View style={styles.thumbWrap}>
        {still ? (
          <Image source={still} style={styles.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        <View style={styles.playBadge}>
          <Text style={styles.playBadgeIcon}>▶</Text>
        </View>
      </View>
      <View style={styles.epInfo}>
        <Text style={styles.epTitle} numberOfLines={1}>
          {ep.episode_number}. {ep.name}
        </Text>
        {ep.overview ? (
          <Text style={styles.epOverview} numberOfLines={2}>
            {ep.overview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  seasonBar: { gap: 8, paddingBottom: 16 },
  seasonChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
  },
  seasonChipActive: { backgroundColor: '#fff' },
  seasonText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  seasonTextActive: { color: '#000' },
  spinner: { marginVertical: 30 },
  epRow: { flexDirection: 'row', marginBottom: 18, gap: 12 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 130, height: 74, borderRadius: 8, backgroundColor: '#1C1C1E' },
  thumbEmpty: { backgroundColor: '#1C1C1E' },
  playBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadgeIcon: { color: '#fff', fontSize: 9, marginLeft: 1 },
  epInfo: { flex: 1, justifyContent: 'center' },
  epTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  epOverview: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
})
