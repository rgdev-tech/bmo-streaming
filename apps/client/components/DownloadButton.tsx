import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import Svg, { Circle } from 'react-native-svg'
import {
  downloadKey,
  getDownload,
  startDownload,
  cancelDownload,
  onDownloadsChange,
  type DownloadItem,
} from '@/lib/download'
import { Touchable } from './Touchable'
import { colors } from '@/lib/theme'

type Props = {
  id: number
  media_type: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path?: string | null
  season?: number
  episode?: number
  episodeTitle?: string
  size?: number
  tintColor?: string
}

export function DownloadButton({
  id, media_type, title, poster_path, backdrop_path,
  season, episode, episodeTitle,
  size = 28, tintColor = '#fff',
}: Props) {
  const key = downloadKey(id, media_type, season, episode)
  const [item, setItem] = useState<DownloadItem | undefined>(undefined)

  useEffect(() => {
    getDownload(key).then(setItem)
    const unsub = onDownloadsChange(() => getDownload(key).then(setItem))
    return unsub
  }, [key])

  const status = item?.status ?? 'idle'
  const progress = item?.progress ?? 0

  async function handlePress() {
    if (status === 'done') {
      await cancelDownload(key)
    } else if (status === 'downloading' || status === 'pending') {
      await cancelDownload(key)
    } else {
      await startDownload({ id, media_type, title, poster_path, backdrop_path, season, episode, episodeTitle })
    }
  }

  const iconSize = { width: size * 0.75, height: size * 0.75 }

  return (
    <Touchable scaleTo={0.85} haptic="medium" onPress={handlePress} hitSlop={10} style={styles.btn}>
      {status === 'done' ? (
        <SymbolView name="arrow.down.circle.fill" tintColor={colors.success} style={{ width: size, height: size }} />

      ) : status === 'downloading' || status === 'pending' ? (
        <CircularProgress size={size} progress={progress} tintColor={tintColor}>
          <SymbolView name="xmark" tintColor={tintColor} style={iconSize} />
        </CircularProgress>

      ) : status === 'error' ? (
        <View style={[styles.errorRing, { width: size, height: size, borderRadius: size / 2 }]}>
          <SymbolView name="arrow.clockwise" tintColor="rgba(255,80,80,0.9)" style={iconSize} />
        </View>

      ) : (
        <SymbolView name="arrow.down.circle" tintColor={tintColor} style={{ width: size, height: size }} />
      )}
    </Touchable>
  )
}

// ── Progreso circular con SVG ──────────────────────────────────────────────

function CircularProgress({
  size, progress, tintColor, children,
}: {
  size: number
  progress: number  // 0–1
  tintColor: string
  children: React.ReactNode
}) {
  const stroke = 2.5
  const r = (size - stroke) / 2
  const cx = size / 2
  const circumference = 2 * Math.PI * r
  const dash = circumference * Math.max(0, Math.min(1, progress))

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Pista */}
        <Circle
          cx={cx} cy={cx} r={r}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Arco de progreso */}
        <Circle
          cx={cx} cy={cx} r={r}
          stroke={tintColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          rotation="-90"
          origin={`${cx},${cx}`}
        />
      </Svg>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  errorRing: {
    borderWidth: 2,
    borderColor: 'rgba(255,80,80,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
