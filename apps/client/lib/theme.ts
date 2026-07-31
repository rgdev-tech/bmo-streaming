import type { TextStyle } from 'react-native'

/**
 * Sistema visual de BMO (teléfono).
 *
 * Fuente única de verdad para color, tipografía, espaciado y radios. Antes esto
 * vivía disperso: 58 colores hex escritos a mano en los componentes y nueve
 * niveles distintos de blanco translúcido para texto secundario (0.3, 0.4,
 * 0.45, 0.5, 0.55, 0.6, 0.7, 0.75, 0.8) sin criterio que los separara. Esa
 * dispersión es lo que hace que una app se sienta "armada de a pedazos" aunque
 * cada pantalla por separado se vea bien.
 *
 * El equivalente para televisor es apps/tv/src/bmo/theme.ts: mismos nombres,
 * escala más grande. Al leer los dos proyectos la correspondencia es directa.
 */

// ── Marca ───────────────────────────────────────────────────────────────────
// Sacados del ícono de la app (BMO): fondo teal con degradado, cara menta,
// rasgos carbón, y los dos botones —triángulo coral y punto periwinkle—. Es la
// identidad que ya existía en el ícono pero que la interfaz no usaba: el acento
// era el azul de sistema de Apple (#0A84FF), que no dice nada de esta app.
const brand = {
  teal: '#5CCAB5',
  tealDeep: '#3BA995',
  mint: '#D2ECE2',
  charcoal: '#1C312D',
  coral: '#E05A4E',
  periwinkle: '#4A90D2',
}

export const colors = {
  // Negro puro, no gris oscuro: es una app de video y en pantallas OLED el
  // contenido “flota” sobre el fondo en vez de vivir dentro de una caja gris.
  bg: '#000',

  // Superficies. surface es el relleno de póster/backdrop mientras carga la
  // imagen y el fondo de los controles; surfaceHigh es un escalón por encima,
  // para lo que debe leerse como elevado sobre una superficie ya elevada.
  surface: '#1C1C1E',
  surfaceHigh: '#2C2C2E',
  // Borde de un pixel entre elementos de una misma superficie. No es un color
  // "gris": es blanco a baja opacidad, así funciona sobre cualquier fondo.
  hairline: 'rgba(255,255,255,0.12)',

  // Texto en cuatro niveles y no en nueve. La regla: primary para lo que se
  // lee, dim para lo que acompaña, muted para metadatos, faint para lo apenas
  // presente (placeholders, separadores tipográficos). Si algo no entra en
  // estos cuatro, casi siempre está mal la jerarquía y no falta un color.
  text: '#fff',
  textDim: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.4)',
  textFaint: 'rgba(255,255,255,0.25)',

  // Acento de marca: el teal de BMO. Va en lo interactivo destacado (progreso,
  // selección activa, foco) — no en todo, o deja de destacar.
  accent: brand.teal,
  accentDeep: brand.tealDeep,
  // Texto/ícono que va ENCIMA del acento. El teal es claro: sobre él el
  // contraste lo da el carbón del ícono, no el blanco.
  onAccent: brand.charcoal,

  // Estados. success queda en el verde de sistema (es el check de "descargado",
  // donde la convención pesa más que la marca); danger e info toman el coral y
  // el periwinkle del ícono para que hasta los errores se vean de esta app.
  success: '#34C759',
  warning: '#FFD60A',
  danger: brand.coral,
  info: brand.periwinkle,

  // Velos sobre imágenes: para que el texto encima de un póster se lea sin
  // depender de si la imagen es clara u oscura.
  scrim: 'rgba(0,0,0,0.5)',
  scrimStrong: 'rgba(0,0,0,0.75)',
}

// Degradados de marca. El de ambiente reemplaza a los índigos sueltos que
// tenían login y perfiles (#171733 / #141428 / #0B0B18): mismo efecto de
// "profundidad hacia el negro", pero tintado con el teal de BMO en vez de un
// azul que no sale de ningún lado.
export const gradients = {
  brand: [brand.teal, brand.tealDeep] as const,
  ambient: ['#12302B', '#081614', '#000'] as const,
  // Funde el borde inferior de una imagen con el fondo de la pantalla.
  scrimDown: ['transparent', 'rgba(0,0,0,0.5)', colors.bg] as const,
}

// ── Tipografía ──────────────────────────────────────────────────────────────
// Dos pesos (700/800 para títulos, 400/600 para el resto) y letter-spacing
// negativo que se acentúa cuanto más grande es el texto: es lo que hace que un
// título grande se vea compuesto y no simplemente “agrandado”.

// "Inicio", "Biblioteca", nombre de marca en Catálogo.
export const screenTitle: TextStyle = {
  fontSize: 34,
  fontWeight: '800',
  color: colors.text,
  letterSpacing: -0.5,
}

// "Tendencias", "Top 10", "Reparto"... — encabezado de fila.
export const rowHeading: TextStyle = {
  fontSize: 20,
  fontWeight: '700',
  color: colors.text,
  letterSpacing: -0.3,
}

// Título dentro del hero de una ficha, cuando no hay logo oficial del título.
export const heroTitle: TextStyle = {
  fontSize: 30,
  fontWeight: '800',
  color: colors.text,
  letterSpacing: -0.6,
}

// Nombre debajo de una tarjeta (póster, reparto, episodio).
export const cardTitle: TextStyle = {
  fontSize: 13,
  fontWeight: '600',
  color: colors.text,
  letterSpacing: -0.1,
}

// Sinopsis y textos largos. lineHeight generoso: en negro sobre blanco el ojo
// se pierde de renglón mucho antes que al revés.
export const body: TextStyle = {
  fontSize: 14,
  fontWeight: '400',
  color: colors.textDim,
  lineHeight: 20,
}

// Metadatos: año, duración, calificación, "3 temporadas".
export const meta: TextStyle = {
  fontSize: 13,
  fontWeight: '500',
  color: colors.textMuted,
}

// Texto dentro de un botón.
export const button: TextStyle = {
  fontSize: 16,
  fontWeight: '700',
  color: colors.text,
  letterSpacing: -0.2,
}

// ── Espaciado ───────────────────────────────────────────────────────────────
// Escala de 4. Usar los tokens y no números sueltos es lo que mantiene el ritmo
// vertical parejo entre pantallas que se escribieron en momentos distintos.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
}

export const radius = {
  sm: 6,
  md: 12,
  lg: 14,
  xl: 20,
  // Píldoras y círculos.
  full: 999,
}

export const layout = {
  // Margen lateral de pantalla. Todo lo que sea texto de sección arranca acá,
  // así las filas horizontales quedan alineadas entre sí.
  screenPadding: 20,
  // Póster 2:3 — la proporción estándar de TMDB.
  posterWidth: 124,
  posterRatio: 1.5,
  // Backdrop 16:9 recortado, medido como fracción del ancho de pantalla para
  // que en un teléfono chico siga entrando "una y un poco" de la siguiente.
  backdropWidthRatio: 0.62,
  backdropRatio: 0.56,
  // Tarjeta de "Seguir viendo": más ancha, es la fila que invita a retomar.
  continueWidth: 300,
  continueRatio: 0.58,
  // Separación entre tarjetas de una fila y entre filas.
  cardGap: 12,
  rowGap: 24,
}
