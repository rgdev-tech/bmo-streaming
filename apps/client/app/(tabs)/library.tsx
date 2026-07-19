import { useCallback, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, Dimensions,
  Alert,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import {
  getMyList,
  getContinueWatching,
  removeFromMyList,
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
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { screenTitle, rowHeading } from '@/lib/typography'
import { backdropUrl } from '@/lib/tmdb'
import type { MediaItem } from '@/lib/tmdb'

const PAD = 20
const GRID_GAP = 12
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - PAD * 2 - GRID_GAP * 2) / 3
)

// Encabezado de sección reutilizable: título a la izquierda, conteo discreto y
// una acción opcional a la derecha. Existe para que TODAS las secciones
// compartan el mismo margen — antes "Mi Lista" se pintaba con un <Text> suelto
// sin padding y quedaba pegada al borde, mientras "Descargas" sí lo tenía.
function SectionHeader({
  title, count, action,
}: {
  title: string
  count?: number
  action?: React.ReactNode
}) {
  return (
    <View style={styles.headingRow}>
      <View style={styles.headingLeft}>
        <Text style={styles.heading}>{title}</Text>
        {count != null && count > 0 && <Text style={styles.count}>{count}</Text>}
      </View>
      {action}
    </View>
  )
}

export default function LibraryScreen() {
  const router = useRouter()
  const [list, setList] = useState<LibraryItem[]>([])
  const [watching, setWatching] = useState<Progress[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [smartEnabled, setSmartEnabled] = useState(true)
  const [editingList, setEditingList] = useState(false)

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
    await removeFromMyList(item.id, item.media_type)
    // Se re-lee del almacenamiento en vez de filtrar el estado: si el borrado
    // no llegó a aplicarse, la pantalla lo refleja en el momento en lugar de
    // mentir hasta la próxima recarga.
    const fresh = await getMyList()
    setList(fresh)
    if (fresh.length === 0) setEditingList(false)
  }

  async function handleDeleteDownload(item: DownloadItem) {
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
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      // La barra de pestañas flota sobre el contenido: sin este colchón, la
      // última fila queda debajo y no se puede tocar.
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Biblioteca</Text>

      {empty ? (
        <View style={styles.emptyBox}>
          <EmptyState
            icon="bookmark"
            title="Tu biblioteca está vacía"
            subtitle="Guarda títulos en Mi Lista, sigue viendo algo o descárgalo para verlo aquí."
          />
        </View>
      ) : (
        <>
          {/* Sin envolver en styles.section: ContinueRow ya aporta su propio
              margen inferior, y sumarlos duplicaba el hueco. */}
          <ContinueRow items={watching} onChange={reload} />

          {downloads.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title="Descargas"
                count={downloads.length}
                action={
                  <Touchable scaleTo={0.95} haptic="light" style={styles.smartPill} onPress={toggleSmart}>
                    <SymbolView
                      name={smartEnabled ? 'bolt.fill' : 'bolt.slash'}
                      tintColor={smartEnabled ? '#FFD60A' : 'rgba(255,255,255,0.4)'}
                      style={styles.smartIcon}
                    />
                    <Text style={[styles.smartText, !smartEnabled && styles.smartTextOff]}>
                      Automática
                    </Text>
                  </Touchable>
                }
              />
              {/* Agrupadas en una tarjeta con separadores, como las listas de
                  iOS: filas sueltas sobre negro no se leían como un conjunto. */}
              <View style={styles.dlGroup}>
                {downloads.map((item, i) => (
                  <View key={item.key}>
                    {i > 0 && <View style={styles.dlSeparator} />}
                    <DownloadRow
                      item={item}
                      onPlay={() => playDownload(item)}
                      onDelete={() => handleDeleteDownload(item)}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {list.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title="Mi Lista"
                count={list.length}
                action={
                  <Touchable
                    scaleTo={0.95}
                    haptic="light"
                    hitSlop={8}
                    onPress={() => setEditingList((v) => !v)}
                  >
                    <Text style={[styles.editText, editingList && styles.editTextOn]}>
                      {editingList ? 'Listo' : 'Editar'}
                    </Text>
                  </Touchable>
                }
              />
              <View style={styles.grid}>
                {list.map((item) => (
                  <PosterCard
                    key={`${item.media_type}-${item.id}`}
                    item={item as MediaItem}
                    width={GRID_CARD}
                    // La X solo en modo edición: permanente ensuciaba cada
                    // póster y se tocaba sin querer al ir a abrir el título.
                    onRemove={editingList ? () => removeFromList(item) : undefined}
                  />
                ))}
              </View>
            </View>
          )}
        </>
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

  // El detalle de segmentos era ruido para el usuario; el porcentaje basta.
  const statusLabel = isLoading
    ? `${Math.round(item.progress * 100)}% descargado`
    : item.status === 'error'
      ? `Error: ${item.error ?? 'desconocido'}`
      : item.quality

  return (
    <Touchable
      scaleTo={0.98}
      haptic="medium"
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
        <Text style={[styles.dlStatus, item.status === 'error' && styles.dlError]} numberOfLines={1}>
          {statusLabel}
        </Text>
      </View>

      <Touchable scaleTo={0.85} haptic="light" style={styles.dlDelete} onPress={onDelete} hitSlop={10}>
        <SymbolView name="trash" tintColor="rgba(255,107,107,0.85)" style={styles.dlDeleteIcon} />
      </Touchable>
    </Touchable>
  )
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { paddingBottom: 130 },
  title: {
    ...screenTitle,
    paddingHorizontal: PAD,
    paddingTop: 12, paddingBottom: 20,
  },
  emptyBox: { paddingTop: 70, alignItems: 'center' },

  // Ritmo vertical uniforme. Antes ContinueRow traía su propio marginBottom y
  // la sección siguiente sumaba marginTop: los ~48px resultantes abrían un
  // hueco que no coincidía con ningún otro espacio de la pantalla.
  section: { marginBottom: 30 },
  headingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: PAD, marginBottom: 13,
  },
  headingLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heading: rowHeading,
  count: { color: 'rgba(255,255,255,0.35)', fontSize: 16, fontWeight: '600' },

  editText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600' },
  editTextOn: { color: '#fff' },

  smartPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
  },
  smartIcon: { width: 12, height: 12 },
  smartText: { color: '#FFD60A', fontSize: 12.5, fontWeight: '600' },
  smartTextOff: { color: 'rgba(255,255,255,0.4)' },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: GRID_GAP, paddingHorizontal: PAD,
  },

  dlGroup: {
    marginHorizontal: PAD,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  dlSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.09)',
    marginLeft: 130, // arranca después de la miniatura, como las listas de iOS
  },
  dlRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 11, gap: 12,
  },
  dlThumbWrap: { position: 'relative' },
  dlThumb: { width: 106, height: 60, borderRadius: 9, backgroundColor: '#1C1C1E' },
  dlThumbEmpty: { backgroundColor: '#1C1C1E' },
  dlProgressOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 3, backgroundColor: 'rgba(255,255,255,0.15)',
    borderBottomLeftRadius: 9, borderBottomRightRadius: 9, overflow: 'hidden',
  },
  dlProgressBar: { height: '100%', backgroundColor: '#fff' },
  dlPlayBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 9,
  },
  dlPlayIcon: { width: 18, height: 18 },
  dlInfo: { flex: 1, gap: 2 },
  dlTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  dlSub: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  dlStatus: { color: 'rgba(255,255,255,0.38)', fontSize: 12 },
  dlError: { color: '#ff6b6b' },
  dlDelete: { padding: 6 },
  dlDeleteIcon: { width: 17, height: 17 },
})
