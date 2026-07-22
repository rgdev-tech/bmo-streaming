import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
  useWindowDimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { stillUrl, tmdb, type Episode, type Season } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { getEpisodeProgress, getWatchedEpisodes } from '@bmo/core/library'
import { colors, layout, rowHeading, safe } from './theme'

const STILL_W = 200
const STILL_H = 113 // 16:9

/**
 * Temporadas y episodios.
 *
 * La temporada se elige con un SELECT (botón que abre un overlay con la lista),
 * en vez de una fila de chips: con muchas temporadas la fila se volvía larguísima
 * y había que barrerla entera. Los episodios van en LISTA VERTICAL —miniatura a
 * la izquierda, título + sinopsis + duración a la derecha— como el detalle de un
 * servicio de streaming, así se lee de qué trata cada uno sin abrirlo.
 */

// ── Select de temporada ─────────────────────────────────────────────────────
function SeasonOption({
  label,
  active,
  hasTVPreferredFocus,
  onPress,
  onFocus,
}: {
  label: string
  active: boolean
  hasTVPreferredFocus?: boolean
  onPress: () => void
  onFocus?: () => void
}) {
  return (
    <Pressable onPress={onPress} onFocus={onFocus} hasTVPreferredFocus={hasTVPreferredFocus}>
      {({ focused }) => (
        <View style={[styles.optionRow, focused && styles.optionRowFocused]}>
          <Text style={[styles.optionLabel, focused && styles.optionLabelFocused]} numberOfLines={1}>
            {label}
          </Text>
          {active && <Ionicons name="checkmark" size={20} color={focused ? '#000' : colors.text} />}
        </View>
      )}
    </Pressable>
  )
}

const MENU_W = 240

function SeasonSelect({
  seasons,
  selected,
  onSelect,
}: {
  seasons: Season[]
  selected: number
  onSelect: (n: number) => void
}) {
  const { height: screenH } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<View>(null)
  const listRef = useRef<FlatList<Season>>(null)
  // Posición del botón en pantalla, para anclar el menú justo debajo (dropdown).
  const [anchor, setAnchor] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const current = seasons.find((s) => s.season_number === selected)
  const currentLabel = current?.name || `Temporada ${selected}`

  const openMenu = () => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h })
      setOpen(true)
    })
  }

  // El menú se abre HACIA ABAJO si hay lugar; si el botón está muy abajo, hacia
  // ARRIBA. En ambos casos el alto se limita al espacio disponible para que
  // entre entero en pantalla y la lista scrollee por dentro (así se ven todas
  // las temporadas al bajar el foco).
  const GAP = 6
  const MARGIN = 28
  const spaceBelow = screenH - (anchor.y + anchor.h) - GAP - MARGIN
  const spaceAbove = anchor.y - GAP - MARGIN
  const openUp = spaceBelow < 260 && spaceAbove > spaceBelow
  const maxH = Math.min(460, Math.max(120, openUp ? spaceAbove : spaceBelow))
  const left = Math.max(safe.horizontal, anchor.x + anchor.w - MENU_W)

  return (
    <>
      <Pressable ref={btnRef} onPress={openMenu} style={styles.selectHit}>
        {({ focused }) => (
          <View style={[styles.selectBtn, focused && styles.selectBtnFocused]}>
            <Text style={[styles.selectLabel, focused && styles.selectLabelFocused]} numberOfLines={1}>
              {currentLabel}
            </Text>
            <Ionicons name="chevron-down" size={18} color={focused ? '#000' : colors.text} />
          </View>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Backdrop transparente: solo capta el tap/Atrás para cerrar, sin atenuar
            la pantalla — así se lee como dropdown y no como panel modal. */}
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          {/* Menú anclado al botón (arriba o abajo según el espacio), alineado a
              su borde derecho, con alto limitado a lo que entra en pantalla. */}
          <View
            style={[
              styles.dropdownMenu,
              { left, maxHeight: maxH },
              openUp
                ? { bottom: screenH - anchor.y + GAP }
                : { top: anchor.y + anchor.h + GAP },
            ]}
          >
            <FlatList
              ref={listRef}
              data={seasons}
              keyExtractor={(s) => String(s.season_number)}
              showsVerticalScrollIndicator={false}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index }) => (
                <SeasonOption
                  label={item.name || `Temporada ${item.season_number}`}
                  active={item.season_number === selected}
                  hasTVPreferredFocus={item.season_number === selected}
                  // Al enfocar una opción, centrarla en el menú: así la lista se
                  // desplaza y se ven todas al recorrerla con la cruceta.
                  onFocus={() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })}
                  onPress={() => {
                    onSelect(item.season_number)
                    setOpen(false)
                  }}
                />
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

// ── Fila de episodio (vertical) ─────────────────────────────────────────────
function EpisodeRow({
  ep,
  watched,
  progress,
  onPress,
}: {
  ep: Episode
  watched: boolean
  /** 0–1, o undefined si nunca se empezó. */
  progress?: number
  onPress?: (ep: Episode) => void
}) {
  const still = stillUrl(ep.still_path, 'original')
  // La barra solo tiene sentido a medias: al 0 no aporta y al 100 lo dice el tilde.
  const showBar = progress != null && progress > 0.02 && progress < 0.98
  const year = ep.air_date ? ep.air_date.slice(0, 4) : null
  const meta = [ep.runtime ? `${ep.runtime} min` : null, year].filter(Boolean).join('  ·  ')

  return (
    <Pressable onPress={() => onPress?.(ep)}>
      {({ focused }) => (
        <View style={[styles.epRow, focused && styles.epRowFocused]}>
          <View style={[styles.stillWrap, focused && styles.stillWrapFocused]}>
            {still ? (
              <Image
                source={still}
                style={styles.still}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
                recyclingKey={String(ep.id)}
              />
            ) : (
              <View style={[styles.still, styles.stillEmpty]}>
                <Text style={styles.stillEmptyText}>Sin imagen</Text>
              </View>
            )}
            {watched && (
              <View style={styles.watchedBadge}>
                <Text style={styles.watchedTick}>✓</Text>
              </View>
            )}
            {showBar && (
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round(progress! * 100)}%` }]} />
              </View>
            )}
          </View>

          <View style={styles.epInfo}>
            <Text style={[styles.epTitle, watched && styles.epDim]} numberOfLines={1}>
              {ep.episode_number}. {ep.name}
            </Text>
            {!!ep.overview && (
              <Text style={styles.epDesc} numberOfLines={2}>
                {ep.overview}
              </Text>
            )}
            {!!meta && <Text style={styles.epMeta}>{meta}</Text>}
          </View>
        </View>
      )}
    </Pressable>
  )
}

export function SeasonEpisodes({
  tvId,
  seasons,
  onPlayEpisode,
}: {
  tvId: string
  seasons: Season[]
  onPlayEpisode?: (season: number, ep: Episode) => void
}) {
  // Se descartan los "especiales" (temporada 0) y las que vienen sin episodios.
  const real = seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)

  const [selected, setSelected] = useState(real[0]?.season_number ?? 1)
  const { data, loading } = useAsync(
    () => tmdb.season(tvId, selected),
    [tvId, selected],
    `season:${tvId}:${selected}`
  )

  // Vistos y progreso se releen al volver a la pantalla, no solo al montar.
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  useFocusEffect(
    useCallback(() => {
      getWatchedEpisodes(tvId).then(setWatched)
      getEpisodeProgress(tvId).then(setProgress)
    }, [tvId])
  )

  if (!real.length) return null

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>Episodios</Text>
        {/* El select solo aparece con más de una temporada. */}
        {real.length > 1 && (
          <SeasonSelect seasons={real} selected={selected} onSelect={setSelected} />
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        // Lista vertical mapeada (no FlatList): esta sección vive dentro del
        // ScrollView de la ficha, y anidar dos listas verticales rompe el scroll.
        // Una temporada tiene ~10-25 episodios, así que renderizarlos todos va bien.
        //
        // TVFocusGuideView con trapFocusLeft/Right: en una lista vertical, la
        // cruceta izquierda/derecha no debe mover el foco a ningún lado (el motor
        // nativo, si no, lo manda al focusable "más cercano" en esa dirección).
        <TVFocusGuideView style={styles.epList} trapFocusLeft trapFocusRight>
          {(data?.episodes ?? []).map((item) => {
            const key = `${selected}:${item.episode_number}`
            return (
              <EpisodeRow
                key={item.id}
                ep={item}
                watched={watched.has(key)}
                progress={progress.get(key)}
                onPress={(ep) => onPlayEpisode?.(selected, ep)}
              />
            )
          })}
        </TVFocusGuideView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginBottom: 30 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: safe.horizontal,
    marginBottom: 14,
  },
  heading: rowHeading,

  // ── Select ──
  selectHit: {},
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(120,120,128,0.28)',
    minWidth: 170,
    justifyContent: 'space-between',
  },
  selectBtnFocused: { backgroundColor: '#fff' },
  selectLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  selectLabelFocused: { color: '#000' },

  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  dropdownMenu: {
    position: 'absolute',
    width: MENU_W,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    paddingVertical: 6,
    overflow: 'hidden',
    // Sombra para que flote sobre el contenido, como un menú desplegable.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  optionRowFocused: { backgroundColor: '#fff' },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  optionLabelFocused: { color: '#000', fontWeight: '700' },

  // ── Episodios ──
  loading: { height: STILL_H + 20, alignItems: 'center', justifyContent: 'center' },
  epList: { paddingHorizontal: safe.horizontal },
  epRow: {
    flexDirection: 'row',
    padding: 8,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  // Realce del foco: fondo tenue + borde en la fila entera (nada de escala, que
  // en una fila ancha se ve raro y puede desbordar).
  epRowFocused: { backgroundColor: 'rgba(255,255,255,0.1)' },
  stillWrap: {
    width: STILL_W,
    height: STILL_H,
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stillWrapFocused: { borderColor: colors.focusBorder },
  still: { width: STILL_W, height: STILL_H, backgroundColor: colors.surface },
  stillEmpty: { alignItems: 'center', justifyContent: 'center' },
  stillEmptyText: { color: colors.textDim, fontSize: 12 },
  watchedBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedTick: { color: '#000', fontSize: 13, fontWeight: '900' },
  barTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  barFill: { height: '100%', backgroundColor: colors.text },
  epInfo: { flex: 1, marginLeft: 16, justifyContent: 'center' },
  epTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  // Los ya vistos se atenúan: al recorrer una temporada larga importa encontrar
  // dónde quedó, no releer lo que ya miró.
  epDim: { color: colors.textDim },
  epDesc: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 5 },
  epMeta: { color: colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 6 },
})
