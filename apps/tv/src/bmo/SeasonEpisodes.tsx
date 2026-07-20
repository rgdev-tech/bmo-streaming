import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { stillUrl, tmdb, type Episode, type Season } from '@bmo/core/tmdb'
import { useAsync } from '@bmo/core/useAsync'
import { getEpisodeProgress, getWatchedEpisodes } from '@bmo/core/library'
import { useFocusScale } from './useFocusScale'
import { colors, layout, rowHeading, safe } from './theme'

const STILL_W = 232
const STILL_H = 130

/**
 * Temporadas y episodios.
 *
 * En el teléfono es una lista vertical; acá los episodios van en fila
 * horizontal, que es como se recorren con la cruceta sin tener que bajar por
 * veinte elementos para llegar al último. El selector de temporada queda arriba
 * como fila propia, así el foco sube a temporadas y baja a episodios de forma
 * natural.
 */
function SeasonChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.06)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={onPress} style={styles.chipHit}>
      {({ focused }) => (
        <Animated.View
          style={[
            styles.chip,
            active && styles.chipActive,
            focused && styles.chipFocused,
            { transform: [{ scale }] },
          ]}
        >
          <Text
            style={[
              styles.chipLabel,
              active && styles.chipLabelActive,
              focused && styles.chipLabelFocused,
            ]}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

function EpisodeCard({
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
  const { scale, onFocus, onBlur } = useFocusScale(1.06)
  const still = stillUrl(ep.still_path)
  // La barra solo tiene sentido a medias: al 0 no aporta nada y al 100 lo dice
  // mejor el tilde de visto.
  const showBar = progress != null && progress > 0.02 && progress < 0.98

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress?.(ep)} style={styles.epHit}>
      {({ focused }) => (
        <Animated.View style={[styles.ep, { transform: [{ scale }] }]}>
          <View style={[styles.stillWrap, focused && styles.stillWrapFocused]}>
            {still ? (
              <Image source={still} style={styles.still} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.still, styles.stillEmpty]}>
                <Text style={styles.stillEmptyText}>Sin imagen</Text>
              </View>
            )}
            {/* El número sobre la miniatura y no debajo: al recorrer rápido con
                la cruceta, la posición en la temporada es lo primero que se
                busca, y ahí siempre está en el mismo lugar. */}
            <View style={styles.epBadge}>
              <Text style={styles.epBadgeText}>{ep.episode_number}</Text>
            </View>

            {/* Visto: tilde arriba a la derecha. Se marca sobre la miniatura y
                no en el texto para que se distinga de un vistazo al recorrer. */}
            {watched && (
              <View style={styles.watchedBadge}>
                <Text style={styles.watchedTick}>✓</Text>
              </View>
            )}

            {/* Empezado a medias: barra al pie de la miniatura. */}
            {showBar && (
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round(progress! * 100)}%` }]} />
              </View>
            )}
          </View>
          <Text style={[styles.epName, watched && styles.epNameWatched]} numberOfLines={1}>
            {ep.name}
          </Text>
          {!!ep.runtime && <Text style={styles.epMeta}>{ep.runtime} min</Text>}
        </Animated.View>
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
  // Se descartan los "especiales" (temporada 0) y las que vienen sin episodios:
  // TMDB las incluye igual y quedarían chips que abren una lista vacía.
  const real = seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)

  const [selected, setSelected] = useState(real[0]?.season_number ?? 1)
  const { data, loading } = useAsync(() => tmdb.season(tvId, selected), [tvId, selected])

  // Vistos y progreso se releen al volver a la pantalla, no solo al montar: lo
  // habitual es entrar acá justo después de terminar un episodio.
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
      <Text style={styles.heading}>Episodios</Text>

      {/* El selector solo aparece con más de una temporada: con una sola sería
          un control que no decide nada. */}
      {real.length > 1 && (
        <FlatList
          horizontal
          data={real}
          keyExtractor={(s) => String(s.season_number)}
          renderItem={({ item }) => (
            <SeasonChip
              label={item.name || `Temporada ${item.season_number}`}
              active={item.season_number === selected}
              onPress={() => setSelected(item.season_number)}
            />
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipList}
        />
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={data?.episodes ?? []}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => {
            // Las claves de vistos y progreso son "temporada:episodio", igual
            // que las guarda el cliente — comparten el mismo almacenamiento.
            const key = `${selected}:${item.episode_number}`
            return (
              <EpisodeCard
                ep={item}
                watched={watched.has(key)}
                progress={progress.get(key)}
                onPress={(ep) => onPlayEpisode?.(selected, ep)}
              />
            )
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.epList}
          initialNumToRender={5}
          windowSize={5}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginBottom: 30 },
  heading: {
    ...rowHeading,
    marginBottom: 12,
    paddingHorizontal: safe.horizontal,
  },

  chipList: { paddingHorizontal: safe.horizontal, paddingBottom: 14, paddingTop: 2 },
  chipHit: { marginRight: 10 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: 'rgba(120,120,128,0.28)',
  },
  chipActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipFocused: { backgroundColor: '#fff' },
  chipLabel: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  chipLabelActive: { color: colors.text },
  chipLabelFocused: { color: '#000', fontWeight: '700' },

  loading: { height: STILL_H + 46, alignItems: 'center', justifyContent: 'center' },
  epList: { paddingHorizontal: safe.horizontal, paddingVertical: 10 },
  epHit: { marginRight: layout.cardGap },
  ep: { width: STILL_W },
  stillWrap: {
    borderRadius: layout.radius,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stillWrapFocused: {
    borderColor: colors.focusBorder,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  still: { width: STILL_W, height: STILL_H, backgroundColor: colors.surface },
  stillEmpty: { alignItems: 'center', justifyContent: 'center' },
  stillEmptyText: { color: colors.textDim, fontSize: 12 },
  epBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
  },
  epBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  watchedBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
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
  epName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  // Los ya vistos se atenúan: al recorrer una temporada larga, lo que importa
  // es encontrar rápido dónde quedó, no releer lo que ya miró.
  epNameWatched: { color: colors.textDim },
  epMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
})
