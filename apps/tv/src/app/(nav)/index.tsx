import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { tmdb, type MediaItem } from '@bmo/core/tmdb'
import { useAsync, prefetchAsync } from '@bmo/core/useAsync'
import { getContinueWatching, syncLibrary, type Progress } from '@bmo/core/library'
import { HeroCarousel, HERO_ITEMS } from '@/bmo/HeroCarousel'
import { ContinueRow } from '@/bmo/ContinueRow'
import { PosterRow } from '@/bmo/PosterRow'
import { RankedRow } from '@/bmo/RankedRow'
import { BackdropRow } from '@/bmo/BackdropRow'
import { RowsList, type RowSection } from '@/bmo/RowsList'
import { colors, rowHeading } from '@/bmo/theme'

export default function HomeScreen() {
  const router = useRouter()
  const { data, loading, error } = useAsync(() => tmdb.home(), [], 'home')

  // "Seguir viendo" arriba de todo: al volver de reproducir algo, este effect
  // corre de nuevo (useFocusEffect) y la fila queda al día. Se pinta con el caché
  // local y se refresca tras sincronizar con Supabase, igual que en Biblioteca.
  const [watching, setWatching] = useState<Progress[]>([])
  useFocusEffect(
    useCallback(() => {
      let alive = true
      async function load() {
        const w0 = await getContinueWatching()
        if (alive) setWatching(w0)
        await syncLibrary()
        const w1 = await getContinueWatching()
        if (alive) setWatching(w1)
      }
      load()
      return () => { alive = false }
    }, [])
  )
  // Las colecciones por plataforma van en su propia petición: son lentas y no
  // deben frenar el primer pintado. La home ya se ve mientras estas llegan.
  const { data: collections } = useAsync(() => tmdb.collections(), [], 'collections')

  // Apenas el Inicio tiene datos, precargamos en silencio las pestañas vecinas
  // (Películas y Series) para que el primer salto a ellas también sea instantáneo.
  useEffect(() => {
    if (!data) return
    prefetchAsync('catalog:movies', () => tmdb.movies())
    prefetchAsync('catalog:series', () => tmdb.series())
  }, [data])

  // TMDB marca el tipo con media_type solo en trending; en las listas de
  // películas/series viene ausente, así que se deduce por la forma del item
  // (las series traen `name`, las películas `title`).
  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.push(`/title/${t}/${item.id}`)
  }

  // "Seguir viendo" lleva directo a reproducir (no a la ficha). Limpiamos el
  // sufijo "· T_:E_" ya guardado antes de re-agregar el del episodio, para que no
  // se acumule (mismo criterio que Biblioteca).
  function resume(p: Progress) {
    router.push({
      pathname: '/player',
      params: {
        type: p.media_type,
        id: String(p.id),
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    )
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>No pude cargar el catálogo</Text>
        <Text style={styles.errorHint}>
          Verificá que el API esté corriendo: bun run dev:api
        </Text>
      </View>
    )
  }

  // Los títulos que rotan arriba se sacan de la fila: tenerlos en el hero y a
  // treinta píxeles en "Tendencias" hace que el catálogo parezca más chico de lo
  // que es. El criterio para entrar al carrusel (backdrop + sinopsis) tiene que
  // ser el mismo que usa HeroCarousel, si no los conjuntos no coinciden.
  const heroIds = new Set(
    data.trending.results
      .filter((i) => i.backdrop_path && i.overview)
      .slice(0, HERO_ITEMS)
      .map((i) => i.id)
  )
  const trendingRest = data.trending.results.filter((i) => !heroIds.has(i.id))

  // Filas como secciones para la lista virtualizada. Solo se incluye lo que tiene
  // contenido (así los índices quedan limpios para el scroll-al-foco). El orden
  // alterna formatos (póster grande → ranking → apaisada) para dar puntos de
  // referencia al bajar y poner lo más fuerte arriba.
  const sections: RowSection[] = []
  if (watching.length) {
    sections.push({ key: 'continue', node: <ContinueRow items={watching} onPressItem={resume} /> })
  }
  sections.push({ key: 'tendencias', node: <PosterRow title="Tendencias" items={trendingRest} onPressItem={openTitle} size="large" /> })
  sections.push({ key: 'top10', node: <RankedRow title="Top 10 películas" items={data.topMovies.results} onPressItem={openTitle} /> })
  if (collections) {
    sections.push({ key: 'netflix', node: <PosterRow title="Lo mejor de Netflix" items={collections.netflix.results} onPressItem={openTitle} /> })
  }
  sections.push({ key: 'popseries', node: <BackdropRow title="Series del momento" items={data.popularSeries.results} onPressItem={openTitle} /> })
  if (collections) {
    sections.push({ key: 'hbo', node: <PosterRow title="Lo mejor de HBO Max" items={collections.hbo.results} onPressItem={openTitle} /> })
    sections.push({ key: 'appletv', node: <BackdropRow title="Lo mejor de Apple TV+" items={collections.appletv.results} onPressItem={openTitle} /> })
    sections.push({ key: 'disney', node: <PosterRow title="Lo mejor de Disney+" items={collections.disney.results} onPressItem={openTitle} /> })
    sections.push({ key: 'prime', node: <PosterRow title="Lo mejor de Prime Video" items={collections.prime.results} onPressItem={openTitle} /> })
  }
  sections.push({ key: 'popmovies', node: <PosterRow title="Películas populares" items={data.popularMovies.results} onPressItem={openTitle} /> })
  sections.push({ key: 'topmovies', node: <BackdropRow title="Mejor valoradas" items={data.topMovies.results} onPressItem={openTitle} /> })

  return (
    <View style={styles.container}>
      <RowsList header={<HeroCarousel items={data.trending.results} />} sections={sections} />
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
    gap: 12,
  },
  errorTitle: rowHeading,
  errorHint: { fontSize: 14, color: colors.textDim },
})
