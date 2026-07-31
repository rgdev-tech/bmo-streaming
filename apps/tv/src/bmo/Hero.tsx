import { useEffect, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, cachedLogo, peekLogo, titleOf, type MediaItem } from '@bmo/core/tmdb'
import { colors, heroOverview, heroTitle, safe } from './theme'

/**
 * Destacado superior: backdrop a sangre con el título encima.
 *
 * No es enfocable a propósito. En Apple TV el héroe es contexto visual, no un
 * control: si fuera enfocable, cada vez que el usuario sube desde la primera
 * fila el foco caería en un elemento que no lleva a ningún lado. Al dejarlo
 * fuera del orden de foco, subir desde la fila de arriba simplemente no hace
 * nada, que es lo que el usuario espera.
 */
export function Hero({ item }: { item: MediaItem }) {
  const { height } = useWindowDimensions()
  // El héroe ocupa ~58% del alto: deja asomar la primera fila de pósters, que es
  // la pista visual de que la pantalla sigue hacia abajo.
  const heroHeight = Math.round(height * 0.58)
  // w1280 en vez de 'original': el panel es ~1920 px de ancho, así que 'original'
  // (a menudo 3840 px) es un decode enorme e inútil que hacía "pesar" cada
  // rotación del carrusel. w1280 se ve bien a distancia de living y pesa ~1/4.
  const uri = backdropUrl(item.backdrop_path, 'w1280')

  // El logo va en su propia petición: TMDB no lo trae en los listados, hay que
  // pedirlo por título. Va cacheado (cachedLogo): el hero rota entre los mismos
  // títulos, y sin caché se re-pediría por red en cada vuelta. Si falla o no
  // existe, queda el título en texto — no es un caso raro.
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  const type = isTv ? 'tv' : 'movie'
  // Si ya lo teníamos resuelto, arrancamos con él directo: sin flash de
  // texto→logo al re-rotar a un título ya visto.
  const [logo, setLogo] = useState<string | null>(() => peekLogo(type, item.id) ?? null)
  useEffect(() => {
    const cached = peekLogo(type, item.id)
    if (cached !== undefined) {
      setLogo(cached) // ya resuelto: sin red, sin parpadeo
      return
    }
    let cancelled = false
    // Se limpia al cambiar de item: sin esto, al rotar el héroe se vería un
    // instante el logo del título anterior sobre el backdrop nuevo.
    setLogo(null)
    cachedLogo(type, item.id).then((url) => !cancelled && setLogo(url))
    return () => {
      cancelled = true
    }
  }, [item.id, type])

  return (
    <View style={[styles.hero, { height: heroHeight }]}>
      {/* cachePolicy 'disk' (no 'memory-disk'): es un bitmap a pantalla completa
          — retenerlo decodificado en RAM pesa demasiado en TVs de 1-2GB. Del
          disco carga igual de rápido y no compite con el resto de la app. */}
      {uri && (
        <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} cachePolicy="disk" recyclingKey={String(item.id)} />
      )}

      {/* Dos degradados en cruz: el vertical funde el borde inferior con las
          filas, el horizontal oscurece la izquierda para que el texto tenga
          contraste sin importar cómo sea la imagen. */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.5)', colors.bg]}
        locations={[0.35, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.25)', 'transparent']}
        locations={[0, 0.45, 0.75]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>
        {logo ? (
          // contentFit "contain" y alineado abajo-izquierda: los logos vienen en
          // proporciones muy distintas (algunos apaisados, otros casi cuadrados)
          // y estirarlos los deforma. Se les fija el alto máximo y se dejan
          // crecer a lo ancho hasta el límite del bloque.
          <Image
            source={logo}
            style={styles.logo}
            contentFit="contain"
            contentPosition="bottom left"
            transition={300}
          />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {titleOf(item)}
          </Text>
        )}
        {!!item.overview && (
          <Text style={styles.overview} numberOfLines={3}>
            {item.overview}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { width: '100%', backgroundColor: colors.bg },
  content: {
    position: 'absolute',
    left: safe.horizontal,
    bottom: 34,
    // El texto no pasa de la mitad de la pantalla: en 16:9 una línea que cruza
    // todo el ancho obliga a barrer la cabeza para leerla.
    maxWidth: '48%',
  },
  title: { ...heroTitle, marginBottom: 10 },
  // Mismo bloque visual que ocuparía el título en texto, para que la sinopsis no
  // salte de posición según el título tenga logo o no.
  logo: { width: '100%', height: 78, marginBottom: 12 },
  overview: heroOverview,
})
