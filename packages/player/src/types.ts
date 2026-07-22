import type { Progress } from '@bmo/core/library'

// Metadatos de un título para persistir progreso (sin los campos que se calculan
// en tiempo de reproducción). Idénticos entre client y tv → "Seguir viendo" y el
// punto de retomar se comparten entre teléfono y TV.
export type MediaMeta = Omit<Progress, 'position' | 'duration' | 'updatedAt'>

// Modo de subtítulo: 'external' = el .srt español que descargamos y dibujamos en
// un overlay JS (estilo/sincronía ajustables); 'none' = apagado; string = id de
// una pista nativa (la pinta el motor de video).
export type SubMode = 'external' | 'none' | string

// Forma mínima de una pista (audio o subtítulo) para detección de idioma y menú.
// Compatible con AudioTrack/SubtitleTrack de expo-video y con las pistas de VLC
// adaptadas (id numérico → string).
export type TrackLike = { id?: string; language?: string; label?: string }
