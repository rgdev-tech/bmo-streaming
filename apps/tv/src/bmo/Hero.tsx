import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, titleOf, type MediaItem } from '@bmo/core/tmdb'
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
  const uri = backdropUrl(item.backdrop_path, 'original')

  return (
    <View style={[styles.hero, { height: heroHeight }]}>
      {uri && (
        <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
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
        <Text style={styles.title} numberOfLines={2}>
          {titleOf(item)}
        </Text>
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
  overview: heroOverview,
})
