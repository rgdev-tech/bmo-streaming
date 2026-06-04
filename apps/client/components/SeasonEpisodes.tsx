import { useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter, useFocusEffect } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { tmdb, stillUrl, isReleased, type Season, type Episode } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { getWatchedEpisodes, toggleEpisodeWatched, setSeasonWatched } from '@/lib/library'

export function SeasonEpisodes({
  tvId,
  title,
  seasons,
  poster,
  backdrop,
}: {
  tvId: string
  title: string
  seasons: Season[]
  poster: string | null
  backdrop: string | null
}) {
  const real = seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)

  const [selected, setSelected] = useState(real[0]?.season_number ?? 1)
  const { data, loading } = useAsync(() => tmdb.season(tvId, selected), [selected])

  // Episodios vistos de esta serie ("season:episode")
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const reloadWatched = useCallback(() => {
    getWatchedEpisodes(tvId).then(setWatched)
  }, [tvId])
  useFocusEffect(reloadWatched)

  async function toggle(season: number, episode: number) {
    Haptics.selectionAsync()
    await toggleEpisodeWatched(tvId, season, episode)
    reloadWatched()
  }

  // Episodios estrenados de la temporada cargada
  const releasedEps = (data?.episodes ?? [])
    .filter((e) => isReleased(e.air_date))
    .map((e) => e.episode_number)
  const allWatched =
    releasedEps.length > 0 &&
    releasedEps.every((e) => watched.has(`${selected}:${e}`))

  async function toggleSeason() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    await setSeasonWatched(tvId, selected, releasedEps, !allWatched)
    reloadWatched()
  }

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

      {/* Marcar temporada completa */}
      {releasedEps.length > 0 && (
        <Pressable style={styles.markSeasonBtn} onPress={toggleSeason}>
          <SymbolView
            name={allWatched ? 'checkmark.circle.fill' : 'circle'}
            tintColor={allWatched ? '#34C759' : 'rgba(255,255,255,0.6)'}
            style={styles.markSeasonIcon}
          />
          <Text style={styles.markSeasonText}>
            {allWatched ? 'Temporada vista' : 'Marcar temporada como vista'}
          </Text>
        </Pressable>
      )}

      {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}

      {data?.episodes.map((ep) => (
        <EpisodeRow
          key={ep.id}
          tvId={tvId}
          title={title}
          season={selected}
          ep={ep}
          poster={poster}
          backdrop={backdrop}
          watched={watched.has(`${selected}:${ep.episode_number}`)}
          onToggleWatched={() => toggle(selected, ep.episode_number)}
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
  poster,
  backdrop,
  watched,
  onToggleWatched,
}: {
  tvId: string
  title: string
  season: number
  ep: Episode
  poster: string | null
  backdrop: string | null
  watched: boolean
  onToggleWatched: () => void
}) {
  const router = useRouter()
  const still = stillUrl(ep.still_path)
  const released = isReleased(ep.air_date)

  function open() {
    router.push({
      pathname: '/player',
      params: {
        type: 'tv',
        id: tvId,
        season: String(season),
        episode: String(ep.episode_number),
        title: `${title} · T${season}:E${ep.episode_number}`,
        poster: poster ?? '',
        backdrop: backdrop ?? '',
      },
    })
  }

  return (
    <Pressable
      style={[styles.epRow, !released && styles.epRowSoon]}
      onPress={released ? open : undefined}
      disabled={!released}
    >
      <View style={styles.thumbWrap}>
        {still ? (
          <Image source={still} style={styles.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        {/* Overlay de visto */}
        {watched && released && (
          <View style={styles.watchedOverlay}>
            <SymbolView name="checkmark.circle.fill" tintColor="#fff" style={styles.watchedCheck} />
          </View>
        )}
        <View style={styles.playBadge}>
          <SymbolView
            name={released ? 'play.fill' : 'clock'}
            tintColor="#fff"
            style={styles.playBadgeIcon}
          />
        </View>
      </View>

      <View style={styles.epInfo}>
        <Text
          style={[styles.epTitle, watched && styles.epTitleWatched]}
          numberOfLines={1}
        >
          {ep.episode_number}. {ep.name}
        </Text>
        {!released ? (
          <Text style={styles.epSoon}>Próximamente</Text>
        ) : ep.overview ? (
          <Text style={styles.epOverview} numberOfLines={2}>
            {ep.overview}
          </Text>
        ) : null}
      </View>

      {/* Botón marcar visto/no visto */}
      {released && (
        <Pressable
          style={styles.markBtn}
          onPress={onToggleWatched}
          hitSlop={10}
        >
          <SymbolView
            name={watched ? 'checkmark.circle.fill' : 'circle'}
            tintColor={watched ? '#34C759' : 'rgba(255,255,255,0.5)'}
            style={styles.markIcon}
          />
        </Pressable>
      )}
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
  markSeasonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    marginBottom: 8,
  },
  markSeasonIcon: { width: 20, height: 20 },
  markSeasonText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 30 },
  epRow: { flexDirection: 'row', marginBottom: 18, gap: 12, alignItems: 'center' },
  epRowSoon: { opacity: 0.5 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 130, height: 74, borderRadius: 8, backgroundColor: '#1C1C1E' },
  thumbEmpty: { backgroundColor: '#1C1C1E' },
  watchedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedCheck: { width: 26, height: 26 },
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
  playBadgeIcon: { width: 10, height: 10 },
  epInfo: { flex: 1, justifyContent: 'center' },
  epTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  epTitleWatched: { color: 'rgba(255,255,255,0.5)' },
  epOverview: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  epSoon: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  markBtn: {
    paddingLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markIcon: { width: 24, height: 24 },
})
