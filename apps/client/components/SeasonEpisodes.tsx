import { useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter, useFocusEffect } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { tmdb, stillUrl, isReleased, type Season, type Episode } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { getWatchedEpisodes, getEpisodeProgress, toggleEpisodeWatched, setSeasonWatched } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { DownloadButton } from './DownloadButton'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

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
  // Y los empezados a medias, para la barra de progreso de cada miniatura.
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const reloadWatched = useCallback(() => {
    getWatchedEpisodes(tvId).then(setWatched)
    getEpisodeProgress(tvId).then(setProgress)
  }, [tvId])
  useFocusEffect(reloadWatched)

  async function toggle(season: number, episode: number) {
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
            <Touchable
              key={s.id}
              scaleTo={0.94}
              haptic="selection"
              onPress={() => setSelected(s.season_number)}
              style={[styles.seasonChip, active && styles.seasonChipActive]}
            >
              <Text style={[styles.seasonText, active && styles.seasonTextActive]}>
                Temporada {s.season_number}
              </Text>
            </Touchable>
          )
        })}
      </ScrollView>

      {/* Marcar temporada completa */}
      {releasedEps.length > 0 && (
        <Touchable scaleTo={0.97} haptic="medium" style={styles.markSeasonBtn} onPress={toggleSeason}>
          <SymbolView
            name={allWatched ? 'checkmark.circle.fill' : 'circle'}
            tintColor={allWatched ? colors.success : colors.textDim}
            style={styles.markSeasonIcon}
          />
          <Text style={styles.markSeasonText}>
            {allWatched ? 'Temporada vista' : 'Marcar temporada como vista'}
          </Text>
        </Touchable>
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
          progress={progress.get(`${selected}:${ep.episode_number}`) ?? 0}
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
  progress,
  onToggleWatched,
}: {
  tvId: string
  title: string
  season: number
  ep: Episode
  poster: string | null
  backdrop: string | null
  watched: boolean
  progress: number // 0–1; 0 = sin empezar
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
    <Touchable
      scaleTo={0.98}
      haptic="light"
      style={[styles.epRow, !released && styles.epRowSoon]}
      onPressIn={released ? () => prewarmTitle(Number(tvId), true, season, ep.episode_number) : undefined}
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
        {/* Hasta dónde se vio. Solo en los empezados y no terminados: al pasar
            del 92% el episodio se marca como visto y muestra el check. */}
        {progress > 0 && !watched && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
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

      {/* Descarga + marcar visto */}
      {released && (
        <View style={styles.rowActions}>
          <DownloadButton
            id={Number(tvId)}
            media_type="tv"
            title={title}
            poster_path={poster}
            backdrop_path={backdrop}
            season={season}
            episode={ep.episode_number}
            episodeTitle={ep.name}
            size={22}
            tintColor={colors.textDim}
          />
          <Touchable
            scaleTo={0.85}
            haptic="selection"
            style={styles.markBtn}
            onPress={onToggleWatched}
            hitSlop={10}
          >
            <SymbolView
              name={watched ? 'checkmark.circle.fill' : 'circle'}
              tintColor={watched ? colors.success : 'rgba(255,255,255,0.5)'}
              style={styles.markIcon}
            />
          </Touchable>
        </View>
      )}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  seasonBar: { gap: 8, paddingBottom: 16 },
  seasonChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
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
  thumb: { width: 130, height: 74, borderRadius: 8, backgroundColor: colors.surface },
  thumbEmpty: { backgroundColor: colors.surface },
  progressTrack: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
    backgroundColor: colors.textFaint,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  markBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markIcon: { width: 24, height: 24 },
})
