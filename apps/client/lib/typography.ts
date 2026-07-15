import type { TextStyle } from 'react-native'

// Título de pantalla: "Inicio" (Home), "Biblioteca", nombre de marca en Catálogo
// (Netflix/HBO/etc). Mismo peso visual en toda la app.
export const screenTitle: TextStyle = {
  fontSize: 34,
  fontWeight: '800',
  color: '#fff',
  letterSpacing: -0.5,
}

// Encabezado de fila de contenido: "Tendencias", "Top 10", "Descargas", "Reparto"...
// Un solo tamaño/peso para que todas las filas de la app se sientan parte del mismo sistema.
export const rowHeading: TextStyle = {
  fontSize: 20,
  fontWeight: '700',
  color: '#fff',
  letterSpacing: -0.3,
}
