import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import * as ScreenOrientation from 'expo-screen-orientation'
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { SymbolView } from 'expo-symbols'
import { stream } from '@/lib/stream'
import { saveProgress, getProgress, type Progress } from '@/lib/library'

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string
    id: string
    season?: string
    episode?: string
    title?: string
    poster?: string
    backdrop?: string
  }>()
  const { type, id, season, episode, title } = params

  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  const episodeN = episode ? Number(episode) : undefined

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [referer, setReferer] = useState('')

  // Forzar horizontal al entrar, restaurar portrait al salir
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const resolveP = isTv
      ? stream.resolveTv(id, seasonN ?? 1, episodeN ?? 1)
      : stream.resolveMovie(id)
    Promise.all([
      resolveP,
      getProgress(Number(id), isTv ? 'tv' : 'movie', seasonN, episodeN),
    ])
      .then(([info, pos]) => {
        if (cancelled) return
        setReferer(info.referer)
        setStartAt(pos)
        setReady(true)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [type, id, season, episode])

  const masterUrl = isTv
    ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1)
    : stream.masterMovie(id)

  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    title: title ?? '',
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={16}>
        <SymbolView name="xmark" tintColor="#fff" style={styles.closeIcon} />
      </Pressable>

      {!ready && !error && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Preparando stream limpio…</Text>
          <Text style={styles.loadingSub}>
            {title ?? ''}
            {season ? `  ·  T${season}:E${episode}` : ''}
          </Text>
          <Text style={styles.loadingHint}>Rompiendo ads y extrayendo el video</Text>
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <SymbolView name="film.stack" tintColor="rgba(255,255,255,0.4)" style={styles.errIcon} />
          <Text style={styles.errText}>No disponible todavía</Text>
          <Text style={styles.errSub}>
            Este título aún no tiene una fuente para reproducir.
          </Text>
          <Pressable style={styles.retry} onPress={() => router.back()}>
            <Text style={styles.retryText}>Volver</Text>
          </Pressable>
        </View>
      )}

      {ready && <Player uri={masterUrl} referer={referer} startAt={startAt} meta={meta} />}
    </View>
  )
}

function Player({
  uri,
  referer,
  startAt,
  meta,
}: {
  uri: string
  referer: string
  startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
}) {
  const seeked = useRef(false)
  const player = useVideoPlayer({ uri, headers: { Referer: referer } }, (p) => {
    p.timeUpdateEventInterval = 5
    p.play()
  })

  // Retomar donde quedó
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && !seeked.current && startAt > 5) {
        player.currentTime = startAt
        seeked.current = true
      }
    })
    return () => sub.remove()
  }, [player, startAt])

  // Guardar progreso cada 5s
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration
      if (duration > 0 && currentTime > 0) {
        saveProgress({ ...meta, position: currentTime, duration })
      }
    })
    return () => sub.remove()
  }, [player])

  return (
    <VideoView
      player={player}
      style={styles.video}
      allowsFullscreen
      allowsPictureInPicture
      nativeControls
      contentFit="contain"
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 20 },
  loadingSub: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 6 },
  loadingHint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
  errIcon: { width: 48, height: 48 },
  errText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  errSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retry: {
    marginTop: 24,
    backgroundColor: '#fff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: { color: '#000', fontWeight: '700' },
  close: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { width: 18, height: 18 },
})
