import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import type { MediaItem } from '@bmo/core/tmdb'
import {
  getContinueWatching,
  getMyList,
  syncLibrary,
  type LibraryItem,
  type Progress,
} from '@bmo/core/library'
import { ContinueRow } from '@/bmo/ContinueRow'
import { PosterCard } from '@/bmo/PosterCard'
import { colors, heroTitle, rowHeading, safe } from '@/bmo/theme'

// Mi Lista va en grilla (no en fila horizontal): es una biblioteca para explorar
// entera, no un carrusel. 6 columnas es lo que entra cómodo en el ancho de
// contenido (960 − rail 58, menos padding) con pósters de tamaño normal.
const GRID_COLS = 6

/**
 * Lo guardado en la biblioteca son `LibraryItem` (solo lo mínimo para pintar
 * una tarjeta), no items completos de TMDB. Se completan los dos campos que las
 * filas dan por sentados en vez de aflojar los tipos de todo el catálogo.
 */
function asMediaItem(item: LibraryItem): MediaItem {
  return { ...item, overview: '', vote_average: 0 }
}

export default function BibliotecaScreen() {
  const router = useRouter()
  const [list, setList] = useState<LibraryItem[]>([])
  const [watching, setWatching] = useState<Progress[]>([])
  const [loaded, setLoaded] = useState(false)

  // Las lecturas son del caché local; `syncLibrary` es lo que lo llena desde
  // Supabase. El core solo sincroniza al elegir perfil, así que sin este paso
  // la TV nunca vería lo que se guardó desde el teléfono después de entrar.
  //
  // Se pinta primero con el caché y se vuelve a leer tras sincronizar: así la
  // pantalla no queda en blanco esperando a la red, pero termina al día.
  useFocusEffect(
    useCallback(() => {
      let alive = true

      async function load() {
        const [l0, w0] = await Promise.all([getMyList(), getContinueWatching()])
        if (!alive) return
        setList(l0)
        setWatching(w0)
        setLoaded(true)

        await syncLibrary()
        const [l1, w1] = await Promise.all([getMyList(), getContinueWatching()])
        if (!alive) return
        setList(l1)
        setWatching(w1)
      }

      load()
      return () => {
        alive = false
      }
    }, [])
  )

  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.push(`/title/${t}/${item.id}`)
  }

  // "Seguir viendo" lleva directo a reproducir, no a la ficha: el usuario ya
  // eligió qué ver, hacerlo pasar por la ficha sería un paso de más.
  function resume(p: Progress) {
    router.push({
      pathname: '/player',
      params: {
        type: p.media_type,
        id: String(p.id),
        // Limpiamos cualquier sufijo "· T_:E_" ya presente en el título guardado
        // (datos viejos viciados) antes de agregar el del episodio actual, para
        // que no se acumule.
        title:
          p.season != null && p.episode != null
            ? `${p.title.replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, '')} · T${p.season}:E${p.episode}`
            : p.title.replace(/(?:\s*·\s*T\d+:E\d+)+\s*$/, ''),
        poster: p.poster_path ?? '',
        backdrop: p.backdrop_path ?? '',
        ...(p.season != null ? { season: String(p.season), episode: String(p.episode) } : {}),
      },
    })
  }

  const empty = loaded && !list.length && !watching.length

  if (empty) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Tu biblioteca está vacía</Text>
        <Text style={styles.emptyHint}>
          Guardá títulos en Mi Lista o empezá a ver algo y va a aparecer acá.
        </Text>
      </View>
    )
  }

  const gridItems = list.map(asMediaItem)

  return (
    <View style={styles.container}>
      {/* Mi Lista como GRILLA vertical de 6 columnas. "Seguir viendo" (fila
          horizontal) y los títulos van en la cabecera de la misma FlatList, así
          todo scrollea junto en vertical sin anidar scrolls. */}
      <FlatList
        data={gridItems}
        keyExtractor={(item) => `${item.media_type}-${item.id}`}
        numColumns={GRID_COLS}
        renderItem={({ item }) => <PosterCard item={item} onPress={openTitle} inGrid />}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Biblioteca</Text>
            <ContinueRow items={watching} onPressItem={resume} />
            {!!gridItems.length && <Text style={styles.sectionLabel}>Mi Lista</Text>}
          </View>
        }
        ListFooterComponent={<View style={styles.tail} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: safe.horizontal,
  },
  // Esta pantalla no tiene hero, así que sí lleva título: sin él arrancaría con
  // una fila colgando del borde superior.
  title: {
    ...heroTitle,
    fontSize: 32,
    paddingHorizontal: safe.horizontal,
    paddingTop: safe.top,
    marginBottom: 22,
  },
  emptyTitle: rowHeading,
  emptyHint: { fontSize: 14, color: colors.textDim, textAlign: 'center' },

  // Encabezado de "Mi Lista", alineado al margen del contenido igual que el resto.
  sectionLabel: {
    ...rowHeading,
    paddingHorizontal: safe.horizontal,
    marginTop: 6,
    marginBottom: 14,
  },
  // El padding horizontal va en la FILA de la grilla (no en el contentContainer)
  // para no duplicar el margen que la cabecera —título y "Seguir viendo"— ya trae.
  gridContent: { paddingBottom: safe.bottom },
  gridRow: {
    paddingHorizontal: safe.horizontal,
    // gap 12 (no cardGap 16): con 6 columnas de 124dp + padding 44, 16 se pasaba
    // del ancho de contenido y RN envolvía la fila a 5 columnas. 12 deja las 6
    // justas con holgura. El margen inferior separa las filas.
    gap: 12,
    marginBottom: 18,
  },
  tail: { height: safe.bottom },
})
