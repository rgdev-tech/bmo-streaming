import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native'
import { useVideoPlayer, VideoView, type VideoViewRef } from 'expo-video'
import { SymbolView } from 'expo-symbols'
import { stream } from '@/lib/stream'
import { saveProgress, getProgress, type Progress } from '@/lib/library'

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string; id: string; season?: string
    episode?: string; title?: string; poster?: string; backdrop?: string
  }>()
  const { type, id, season, episode, title } = params
  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  const episodeN = episode ? Number(episode) : undefined

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [referer, setReferer] = useState('')

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
    return () => { cancelled = true }
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
      {/* Loading */}
      {!ready && !error && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Preparando…</Text>
          {!!title && (
            <Text style={styles.loadingSub}>
              {title}{season ? `  ·  T${season}:E${episode}` : ''}
            </Text>
          )}
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.center}>
          <SymbolView name="film.stack" tintColor="rgba(255,255,255,0.4)" style={styles.errIcon} />
          <Text style={styles.errText}>No disponible</Text>
          <Text style={styles.errSub}>
            Este título aún no tiene una fuente de reproducción.
          </Text>
          <Pressable style={styles.retry} onPress={() => router.back()}>
            <Text style={styles.retryText}>Volver</Text>
          </Pressable>
        </View>
      )}

      {/* Player nativo — se presenta en fullscreen automáticamente */}
      {ready && (
        <NativePlayer
          uri={masterUrl}
          referer={referer}
          startAt={startAt}
          meta={meta}
          onClose={() => router.back()}
        />
      )}
    </View>
  )
}

function NativePlayer({
  uri,
  referer,
  startAt,
  meta,
  onClose,
}: {
  uri: string
  referer: string
  startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  onClose: () => void
}) {
  const viewRef = useRef<VideoViewRef>(null)
  const seeked = useRef(false)
  const enteredFS = useRef(false)

  const player = useVideoPlayer(
    { uri, headers: { Referer: referer } },
    (p) => {
      p.timeUpdateEventInterval = 5
      p.play()
    }
  )

  // Seek + entrar fullscreen cuando el video está listo
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status !== 'readyToPlay') return

      if (!seeked.current && startAt > 5) {
        player.currentTime = startAt
        seeked.current = true
      }

      if (!enteredFS.current) {
        enteredFS.current = true
        // Pequeño delay para que el ref esté montado
        setTimeout(() => viewRef.current?.enterFullscreen(), 80)
      }
    })
    return () => sub.remove()
  }, [player, startAt])

  // Guardar progreso cada 5 s
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const dur = player.duration
      if (dur > 0 && currentTime > 0) {
        saveProgress({ ...meta, position: currentTime, duration: dur })
      }
    })
    return () => sub.remove()
  }, [player])

  return (
    // La vista vive en el árbol (tamaño mínimo) y el fullscreen
    // se presenta sobre ella como modal nativo de iOS (AVPlayerViewController).
    // onFullscreenExit → el usuario pulsó Done → volvemos atrás.
    <VideoView
      ref={viewRef}
      player={player}
      style={styles.hiddenView}
      nativeControls
      allowsFullscreen
      allowsPictureInPicture
      contentFit="contain"
      onFullscreenExit={onClose}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // La vista inline es invisible; el video se ve en el modal fullscreen nativo
  hiddenView: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 20 },
  loadingSub: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 6, textAlign: 'center' },
  errIcon: { width: 48, height: 48 },
  errText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  errSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 20 },
  retry: { marginTop: 24, backgroundColor: '#fff', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: '#000', fontWeight: '700' },
})
