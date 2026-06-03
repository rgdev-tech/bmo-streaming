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
import { stream, type StreamResult } from '@/lib/stream'

export default function PlayerScreen() {
  const router = useRouter()
  const { type, id, season, episode, title } = useLocalSearchParams<{
    type: string
    id: string
    season?: string
    episode?: string
    title?: string
  }>()

  const [result, setResult] = useState<StreamResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run =
      type === 'tv'
        ? stream.tv(id, Number(season ?? 1), Number(episode ?? 1))
        : stream.movie(id)
    run
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [type, id, season, episode])

  return (
    <View style={styles.container}>
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={16}>
        <SymbolView name="xmark" tintColor="#fff" style={styles.closeIcon} />
      </Pressable>

      {!result && !error && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Preparando stream limpio…</Text>
          <Text style={styles.loadingSub}>
            {title ?? ''}
            {season ? `  ·  T${season}:E${episode}` : ''}
          </Text>
          <Text style={styles.loadingHint}>
            Rompiendo ads y extrayendo el video (puede tardar unos segundos)
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <SymbolView name="exclamationmark.triangle" tintColor="#FF6B6B" style={styles.errIcon} />
          <Text style={styles.errText}>No pude obtener el stream</Text>
          <Pressable style={styles.retry} onPress={() => router.back()}>
            <Text style={styles.retryText}>Volver</Text>
          </Pressable>
        </View>
      )}

      {result && <Player result={result} />}
    </View>
  )
}

function Player({ result }: { result: StreamResult }) {
  const player = useVideoPlayer(
    { uri: result.url, headers: result.headers },
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
  errText: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 16 },
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
