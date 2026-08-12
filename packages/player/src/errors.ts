// Traducción de errores técnicos a algo que se pueda leer en pantalla.
//
// Lo que llega acá viene de tres lugares y ninguno escribe para un humano: el
// cliente HTTP (`API 404 en /resolve/movie/550`), el fetch del runtime
// (`Network request failed`, `Aborted`) y los motores de video
// (`CoreMediaErrorDomain -12642`). Mostrarlo crudo era lo que hacía el
// reproductor hasta ahora.
//
// Módulo puro: sin red ni estado, un caso por rama.

export type FriendlyError = {
  // Frase principal: qué pasó, en un renglón.
  title: string
  // Qué puede hacer al respecto, o el detalle crudo si no lo reconocemos.
  detail: string
}

const UNKNOWN_TITLE = 'No se pudo reproducir'

/**
 * `raw` es el mensaje tal cual lo dejó el error. Cuando no se reconoce el
 * patrón se conserva como `detail`: es preferible mostrar algo técnico a
 * inventar una explicación que puede no ser la correcta.
 */
export function describePlaybackError(raw: string | null | undefined): FriendlyError {
  const msg = (raw ?? '').trim()
  if (!msg) return { title: UNKNOWN_TITLE, detail: 'No hay más detalle disponible.' }

  // El resolver no encontró ninguna fuente para el título. Es el 404 más común
  // y NO es un error de la app: simplemente hoy no hay de dónde sacarlo.
  if (/\bAPI 404\b/.test(msg)) {
    return {
      title: 'No encontramos ninguna fuente',
      detail: 'Ningún proveedor tiene este contenido ahora mismo. Suele aparecer con estrenos muy recientes; probá de nuevo más tarde.',
    }
  }

  // Elección manual de calidad que no resolvió (ver pickSource). Se distingue
  // del resto: acá NO se agotó nada, las otras fuentes siguen estando.
  if (/no se pudo abrir esa fuente/i.test(msg)) {
    return {
      title: 'Esa calidad no se pudo abrir',
      detail: 'Elegí otra desde el menú de calidad: las demás fuentes siguen disponibles.',
    }
  }

  if (/\bAPI 429\b/.test(msg)) {
    return {
      title: 'Demasiados intentos seguidos',
      detail: 'Esperá un minuto antes de volver a probar.',
    }
  }

  if (/\bAPI 5\d\d\b/.test(msg)) {
    return {
      title: 'El servidor tuvo un problema',
      detail: 'No es tu conexión. Reintentá en unos segundos.',
    }
  }

  // AbortSignal del cliente HTTP (RESOLVE_TIMEOUT) o del propio runtime.
  if (/\babort/i.test(msg) || /\btimed?\s?out\b/i.test(msg) || /\btimeout\b/i.test(msg)) {
    return {
      title: 'La búsqueda tardó demasiado',
      detail: 'Los proveedores están lentos. Reintentá: la segunda vez suele salir del caché y arranca al toque.',
    }
  }

  if (/network request failed/i.test(msg) || /\bnetwork\b/i.test(msg) || /offline/i.test(msg)) {
    return {
      title: 'Sin conexión',
      detail: 'Revisá el WiFi o los datos y reintentá.',
    }
  }

  // Errores del motor de video: AVPlayer (CoreMediaErrorDomain -12642 y
  // similares) y VLCKit. Acá ya se probaron todas las fuentes del fallback.
  if (/coremedia|avfoundation|vlc|codec|decod|playback|-1\d{4}\b/i.test(msg)) {
    return {
      title: 'Ninguna fuente se pudo reproducir',
      detail: 'Probamos varias y todas fallaron en este dispositivo. Probá elegir otra calidad desde el menú.',
    }
  }

  return { title: UNKNOWN_TITLE, detail: msg }
}
