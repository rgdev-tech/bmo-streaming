import type { TextStyle } from 'react-native'

/**
 * Sistema visual de BMO TV.
 *
 * Es el mismo lenguaje que apps/client (negro puro, jerarquía de dos pesos,
 * letter-spacing negativo en títulos) escalado a distancia de living: en un
 * televisor se mira desde ~3 m, así que todo va aproximadamente al doble que en
 * teléfono. Los nombres se mantienen iguales a lib/typography.ts del cliente
 * para que la correspondencia sea obvia al leer los dos proyectos.
 */

export const colors = {
  bg: '#000',
  text: '#fff',
  textDim: 'rgba(235,235,245,0.6)',
  // Relleno de placeholders y superficies elevadas. Gris de sistema de Apple.
  surface: 'rgba(120,120,128,0.24)',
  // El foco en TV se marca con un borde blanco puro: sobre negro es el contraste
  // máximo posible y no depende de que el póster sea claro u oscuro.
  focusBorder: '#fff',
}

/**
 * OJO con la escala: un TV 1080p reporta 960x540 dp (densidad 2x), no 1920x1080.
 * O sea que el lienzo en puntos es apenas 2,5 veces el de un teléfono, no 5.
 * Los tamaños de acá están calibrados contra ese ancho de 960 dp — subirlos
 * "porque es una tele" hace que entren cuatro pósters por fila.
 */

// "Inicio" — título de pantalla. 34 en teléfono → 30 acá (el teléfono usa un
// título proporcionalmente más grande porque su pantalla es angosta).
export const screenTitle: TextStyle = {
  fontSize: 30,
  fontWeight: '800',
  color: colors.text,
  letterSpacing: -0.5,
}

// "Tendencias", "Top 10"... — encabezado de fila.
export const rowHeading: TextStyle = {
  fontSize: 18,
  fontWeight: '700',
  color: colors.text,
  letterSpacing: -0.3,
}

// Título dentro del hero. Es el elemento más grande de la pantalla.
export const heroTitle: TextStyle = {
  fontSize: 44,
  fontWeight: '800',
  color: colors.text,
  letterSpacing: -0.9,
}

export const heroOverview: TextStyle = {
  fontSize: 14,
  fontWeight: '400',
  color: colors.textDim,
  lineHeight: 20,
}

/**
 * Márgenes seguros de televisor. Los TV recortan los bordes de la imagen
 * (overscan), así que nada legible puede vivir contra el borde físico del panel.
 * El 5% es la convención de la industria; a 1920px son ~96px.
 */
export const safe = {
  horizontal: 44,
  top: 28,
  bottom: 32,
}

export const layout = {
  // Póster 2:3, misma proporción que el cliente. 124 dp en un ancho de 960 deja
  // ver ~7 por fila, que es la densidad de Apple TV: suficientes para dar idea
  // de catálogo sin que se vuelvan miniaturas.
  posterWidth: 124,
  posterHeight: 186,
  // Póster grande, para la fila destacada de cada pantalla: rompe la monotonía de
  // que todas las filas tengan tarjetas del mismo tamaño.
  posterWidthLg: 168,
  posterHeightLg: 252,
  // Backdrop 16:9 para filas apaisadas.
  backdropWidth: 248,
  backdropHeight: 140,
  cardGap: 16,
  rowGap: 30,
  radius: 8,
  // Rail de navegación: angosto en reposo (solo iconos), se despliega al recibir
  // foco. El contenido se corre por `railWidth` y NO por el ancho desplegado,
  // así el despliegue tapa el contenido momentáneamente en vez de reacomodarlo
  // entero — reacomodar todo el catálogo en cada entrada al menú se ve pésimo.
  railWidth: 58,
  railExpandedWidth: 190,
  // Cuánto crece una tarjeta al recibir foco. Sutil a propósito: Apple usa un
  // realce leve, no un salto — el borde y la sombra hacen el resto del trabajo.
  focusScale: 1.08,
}
