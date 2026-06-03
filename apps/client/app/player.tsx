import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native'
import { useVideoPlayer, VideoView } from 'expo-video'
import { SymbolView } from 'expo-symbols'
import { stream, STREAM_HEADERS } from '@/lib/stream'

export default function PlayerScreen() {
  const router = useRouter()
  const { type, id, season, episode, title } = useLocalSearchParams<{
    type: string
    id: string
    season?: string
    episode?: string
    title?: string
  }>()

  const isTv = type === 'tv'
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = isTv
      ? stream.resolveTv(id, Number(season ?? 1), Number(episode ?? 1))
      : stream.resolveMovie(id)
    run
      .then(() => !cancelled && setReady(true))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [type, id, season, episode])

  const masterUrl = isTv
    ? stream.masterTv(id, Number(season ?? 1), Number(episode ?? 1))
    : stream.masterMovie(id)

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
          <Text style={styles.loadingHint}>
            Rompiendo ads y extrayendo el video
          </Text>
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

      {ready && <Player uri={masterUrl} />}
    </View>
  )
}

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(
    { uri, headers: STREAM_HEADERS },
    (p) => {
      p.play()
    }
  )

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
