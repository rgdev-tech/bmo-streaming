import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { tmdb, type MediaItem } from '@bmo/core/tmdb'
import { matchStudio, type StudioBrand } from '@bmo/core/studios'
import { Keyboard } from '@/bmo/Keyboard'
import { PosterCard } from '@/bmo/PosterCard'
import { PersonResultCard } from '@/bmo/PersonResultCard'
import { StudioBanner } from '@/bmo/StudioBanner'
import { colors, layout, rowHeading, safe } from '@/bmo/theme'

const MIN_CHARS = 2
const DEBOUNCE_MS = 450
const MAX_PEOPLE = 3

export default function BuscarScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [people, setPeople] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // El match de marca es local: no espera a la red, así que el banner de Disney
  // o Marvel ya está mientras TMDB todavía responde.
  const brand: StudioBrand | null = matchStudio(query)

  // Debounce: con teclado en pantalla cada letra es deliberada, pero el usuario
  // igual encadena varias rápido al recorrer la grilla. Sin esto se dispararía
  // una petición por letra.
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_CHARS) {
      setResults([])
      setPeople([])
      setSearched(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      tmdb
        .search(q)
        .then((r) => {
          if (cancelled) return
          // Títulos y personas se separan porque se muestran distinto: los
          // primeros como pósters, las segundas como fichas con foto redonda.
          // Se exigen imagen en ambos casos — sin ella la tarjeta queda hueca.
          setResults(r.results.filter((i) => i.media_type !== 'person' && i.poster_path))
          setPeople(
            r.results
              .filter((i) => i.media_type === 'person' && i.profile_path)
              .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
              .slice(0, MAX_PEOPLE)
          )
          setSearched(true)
        })
        .catch(() => {
          if (cancelled) return
          setResults([])
          setPeople([])
        })
        .finally(() => !cancelled && setLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  function openTitle(item: MediaItem) {
    const t = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
    router.push(`/title/${t}/${item.id}`)
  }

  const hasExtras = !!brand || people.length > 0
  const showEmpty = !loading && searched && !results.length && !hasExtras

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {/* El texto escrito, justo encima del teclado: en TV el usuario mira las
            teclas. Si el campo estuviera arriba de todo tendría que levantar la
            vista en cada letra para confirmar lo que lleva escrito. */}
        <View style={styles.field}>
          <Text style={[styles.query, !query && styles.queryEmpty]} numberOfLines={1}>
            {query || 'Buscar…'}
          </Text>
          {!!query && <View style={styles.caret} />}
        </View>

        <Keyboard
          onChar={(c) => setQuery((q) => q + c)}
          onBackspace={() => setQuery((q) => q.slice(0, -1))}
          onSpace={() => setQuery((q) => (q ? q + ' ' : q))}
          onClear={() => setQuery('')}
        />
      </View>

      <View style={styles.right}>
        {loading && !hasExtras && (
          <View style={styles.status}>
            <ActivityIndicator color={colors.text} />
          </View>
        )}

        {(!loading || hasExtras) && (
          <FlatList
            data={results}
            keyExtractor={(item) => `${item.media_type}-${item.id}`}
            numColumns={4}
            renderItem={({ item }) => <PosterCard item={item} onPress={openTitle} inGrid />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            // La cabecera va dentro del FlatList y no encima: así marca y
            // personas scrollean junto con los títulos en vez de quedar fijas
            // ocupando espacio mientras el usuario recorre la cuadrícula.
            ListHeaderComponent={
              hasExtras ? (
                <View>
                  {brand && (
                    <StudioBanner brand={brand} onPress={(b) => router.push(`/studio/${b.key}`)} />
                  )}
                  {people.length > 0 && (
                    <View style={styles.peopleBlock}>
                      <Text style={styles.sectionLabel}>Personas</Text>
                      {people.map((p) => (
                        <PersonResultCard
                          key={p.id}
                          person={p}
                          onPress={(x) => router.push(`/person/${x.id}`)}
                        />
                      ))}
                    </View>
                  )}
                  {results.length > 0 && <Text style={styles.sectionLabel}>Títulos</Text>}
                </View>
              ) : null
            }
          />
        )}

        {showEmpty && (
          <View style={styles.status}>
            <Text style={styles.emptyTitle}>Sin resultados</Text>
            <Text style={styles.emptyHint}>Probá con otro título.</Text>
          </View>
        )}

        {!loading && !searched && !brand && (
          <View style={styles.status}>
            <Text style={styles.emptyHint}>
              Escribí al menos {MIN_CHARS} letras para buscar.
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Cuentas de ancho, ajustadas — conviene no romperlas:
  //   960 (pantalla) − 58 (rail) − 14 − 258 (teclado) − 24 − 18 = 588 dp
  //   − 20 dp de padding de la grilla                          = 568 usables
  //   4 pósters × 128 + 3 separaciones × 16                    = 560 → entran
  //
  // OJO con el 128: el póster mide 124, pero el borde de foco suma 2 dp por
  // lado. Calcularlo con 124 daba 8 dp de más y la cuarta columna aparecía
  // cortada. La separación va como `gap` de la fila y no como margen de la
  // tarjeta, para que la última columna no arrastre un margen inútil.
  //
  // Los 10 dp de padding por lado NO son decorativos: son el espacio donde
  // crecen las tarjetas al enfocarse. Sin ellos el FlatList les corta el borde.
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
    paddingTop: safe.top,
    paddingLeft: 14,
    paddingRight: 18,
    gap: 24,
  },
  left: { width: 258 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255,255,255,0.25)',
    marginBottom: 18,
    gap: 3,
  },
  query: { fontSize: 21, fontWeight: '700', color: colors.text, flexShrink: 1 },
  queryEmpty: { color: 'rgba(235,235,245,0.35)', fontWeight: '500' },
  caret: { width: 2, height: 23, backgroundColor: colors.text },

  right: { flex: 1 },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: rowHeading,
  emptyHint: { fontSize: 14, color: colors.textDim },
  grid: {
    // El aire lateral y superior es lo que evita que se recorten los bordes de
    // las tarjetas enfocadas al escalar (ver la cuenta en `container`).
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: safe.bottom,
  },
  gridRow: { gap: layout.cardGap, marginBottom: layout.cardGap },
  peopleBlock: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textDim,
    marginBottom: 10,
  },
})
