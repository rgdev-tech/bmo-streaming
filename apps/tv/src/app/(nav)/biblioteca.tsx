import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
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
import { PosterRow } from '@/bmo/PosterRow'
import { colors, heroTitle, rowHeading, safe } from '@/bmo/theme'

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
        console.log(`[biblioteca] tras sync: ${l1.length} en Mi Lista, ${w1.length} en seguir viendo`)
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
        title:
          p.season != null && p.episode != null
            ? `${p.title} · T${p.season}:E${p.episode}`
            : p.title,
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

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Biblioteca</Text>

        <ContinueRow items={watching} onPressItem={resume} />

        {!!list.length && (
          <PosterRow
            title="Mi Lista"
            items={list.map(asMediaItem)}
            onPressItem={openTitle}
          />
        )}

        <View style={styles.tail} />
      </ScrollView>
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
  tail: { height: safe.bottom },
})
