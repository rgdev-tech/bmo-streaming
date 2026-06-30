import { useCallback, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, Dimensions,
  Pressable, Alert,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import {
  getMyList,
  getContinueWatching,
  toggleMyList,
  type LibraryItem,
  type Progress,
} from '@/lib/library'
import {
  getDownloads,
  deleteDownload,
  onDownloadsChange,
  isSmartDownloadEnabled,
  setSmartDownload,
  type DownloadItem,
} from '@/lib/download'
import { PosterCard } from '@/components/PosterCard'
import { ContinueRow } from '@/components/ContinueRow'
import { backdropUrl } from '@/lib/tmdb'
import type { MediaItem } from '@/lib/tmdb'

const GRID_GAP = 12
const GRID_PAD = 20
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3
)

export default function LibraryScreen() {
  const router = useRouter()
  const [list, setList] = useState<LibraryItem[]>([])
  const [watching, setWatching] = useState<Progress[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [smartEnabled, setSmartEnabled] = useState(true)

  const reload = useCallback(() => {
    getMyList().then(setList)
    getContinueWatching().then(setWatching)
    getDownloads().then(setDownloads)
    isSmartDownloadEnabled().then(setSmartEnabled)
  }, [])

  useFocusEffect(reload)

  // Suscripción en tiempo real a cambios de descargas
  useFocusEffect(useCallback(() => {
    return onDownloadsChange(() => getDownloads().then(setDownloads))
  }, []))

  async function removeFromList(item: LibraryItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await toggleMyList(item)
    setList(prev => prev.filter(i => !(i.id === item.id && i.media_type === item.media_type)))
  }

  async function handleDeleteDownload(item: DownloadItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert(
      'Eliminar descarga',
      `¿Eliminar "${item.title}"${item.episode ? ` T${item.season}:E${item.episode}` : ''}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            await deleteDownload(item.key)
            getDownloads().then(setDownloads)
          },
        },
      ]
    )
  }

  function playDownload(item: DownloadItem) {
    if (item.status !== 'done') return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push({
      pathname: '/player',
      params: {
        type: item.media_type,
        id: String(item.id),
        title: item.episode
          ? `${item.title} · T${item.season}:E${item.episode}`
          : item.title,
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(item.media_type === 'tv' ? {
          season: String(item.season),
          episode: String(item.episode),
        } : {}),
        localPath: item.localPath ?? '',
      },
    })
  }

  async function toggleSmart() {
    const next = !smartEnabled
    setSmartEnabled(next)
    await setSmartDownload(next)
  }

  const empty = list.length === 0 && watching.length === 0 && downloads.length === 0

  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.title}>Biblioteca</Text>

      {empty && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Aquí aparecerá lo que guardes en Mi Lista, lo que estés viendo y tus descargas.
          </Text>
        </View>
      )}

      <ContinueRow items={watching} onChange={reload} />

      {/* Sección Descargas */}
      {downloads.length > 0 && (
        <View style={styles.section}>
          <View style={styles.headingRow}>
            <Text style={styles.heading}>Descargas</Text>
            <Pressable style={styles.smartPill} onPress={toggleSmart}>
              <SymbolView
                name={smartEnabled ? 'bolt.fill' : 'bolt.slash'}
                tintColor={smartEnabled ? '#FFD60A' : 'rgba(255,255,255,0.4)'}
                style={styles.smartIcon}
              />
              <Text style={[styles.smartText, !smartEnabled && styles.smartTextOff]}>
                Descarga inteligente
              </Text>
            </Pressable>
          </View>

          {downloads.map(item => (
            <DownloadRow
              key={item.key}
              item={item}
              onPlay={() => playDownload(item)}
              onDelete={() => handleDeleteDownload(item)}
            />
          ))}
        </View>
      )}

      {list.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.heading}>Mi Lista</Text>
          <View style={styles.grid}>
            {list.map(item => (
              <PosterCard
                key={`${item.media_type}-${item.id}`}
                item={item as MediaItem}
                width={GRID_CARD}
                onRemove={() => removeFromList(item)}
              />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  )
}

// ── Fila de descarga ──────────────────────────────────────────────────────────

function DownloadRow({
  item, onPlay, onDelete,
}: {
  item: DownloadItem
  onPlay: () => void
  onDelete: () => void
}) {
  const thumb = backdropUrl(item.backdrop_path ?? item.poster_path, 'w780')
  const isDone = item.status === 'done'
  const isLoading = item.status === 'downloading' || item.status === 'pending'

  const subtitle = item.media_type === 'tv' && item.season
    ? `T${item.season}:E${item.episode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
    : item.quality || ''

  const statusLabel = isLoading
    ? `${Math.round(item.progress * 100)}% · ${item.downloadedSegments}/${item.totalSegments} segmentos`
    : item.status === 'error'
      ? `Error: ${item.error ?? 'desconocido'}`
      : item.quality

  return (
    <Pressable
      style={styles.dlRow}
      onPress={isDone ? onPlay : undefined}
      disabled={!isDone}
    >
      <View style={styles.dlThumbWrap}>
        {thumb ? (
          <Image source={thumb} style={styles.dlThumb} contentFit="cover" />
        ) : (
          <View style={[styles.dlThumb, styles.dlThumbEmpty]} />
        )}
        {isDone && (
          <View style={styles.dlPlayBadge}>
            <SymbolView name="play.fill" tintColor="#fff" style={styles.dlPlayIcon} />
          </View>
        )}
        {isLoading && (
          <View style={styles.dlProgressOverlay}>
            <View style={[styles.dlProgressBar, { width: `${Math.round(item.progress * 100)}%` }]} />
          </View>
        )}
      </View>

      <View style={styles.dlInfo}>
        <Text style={styles.dlTitle} numberOfLines={1}>{item.title}</Text>
        {subtitle ? <Text style={styles.dlSub} numberOfLines={1}>{subtitle}</Text> : null}
        <Text style={styles.dlStatus} numberOfLines={1}>{statusLabel}</Text>
      </View>

      <Pressable style={styles.dlDelete} onPress={onDelete} hitSlop={10}>
        <SymbolView
          name="trash"
          tintColor="rgba(255,80,80,0.8)"
          style={styles.dlDeleteIcon}
        />
      </Pressable>
    </Pressable>
  )
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  title: {
    fontSize: 34, fontWeight: '700', color: '#fff',
    letterSpacing: -0.5, paddingHorizontal: 20,
    paddingTop: 16, paddingBottom: 8,
  },
  emptyBox: { paddingHorizontal: 24, paddingTop: 80, alignItems: 'center' },
  emptyText: {
    color: 'rgba(255,255,255,0.4)', fontSize: 15,
    textAlign: 'center', lineHeight: 22,
  },
  section: { marginTop: 24, marginBottom: 8 },
  headingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  heading: {
    color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.3,
  },
  smartPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  smartIcon: { width: 13, height: 13 },
  smartText: { color: '#FFD60A', fontSize: 12, fontWeight: '600' },
  smartTextOff: { color: 'rgba(255,255,255,0.4)' },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: GRID_GAP, paddingHorizontal: GRID_PAD,
  },

  // Fila de descarga
  dlRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, gap: 12,
  },
  dlThumbWrap: { position: 'relative' },
  dlThumb: { width: 110, height: 62, borderRadius: 8, backgroundColor: '#1C1C1E' },
  dlThumbEmpty: { backgroundColor: '#1C1C1E' },
  dlProgressOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 3, backgroundColor: 'rgba(255,255,255,0.15)',
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden',
  },
  dlProgressBar: { height: '100%', backgroundColor: '#fff' },
  dlPlayBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 8,
  },
  dlPlayIcon: { width: 18, height: 18 },
  dlInfo: { flex: 1, gap: 3 },
  dlTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  dlSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  dlStatus: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  dlDelete: { padding: 4 },
  dlDeleteIcon: { width: 18, height: 18 },
})
