export type SrtCue = { start: number; end: number; text: string }

// Los .srt de opensubtitles no siempre son UTF-8 real pese a que la URL lo
// diga (confirmado con archivos reales: vienen en Latin-1/Windows-1252).
// `binaryString` viene de atob() sobre el base64 del archivo — cada char code
// ya ES el byte crudo. Si es UTF-8 válido lo decodificamos bien; si no (o si
// el runtime no tiene TextDecoder), el binary string YA es la lectura
// Latin-1 correcta byte a byte, así que sirve tal cual.
export function decodeSrtBytes(binaryString: string): string {
  try {
    const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
    const TD = (globalThis as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder
    if (!TD) return binaryString
    const decoder = new TD('utf-8', { fatal: true })
    return decoder.decode(bytes)
  } catch {
    return binaryString
  }
}

function parseSrtTime(s: string): number {
  const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return 0
  const [, h, mi, se, ms] = m
  return Number(h) * 3600 + Number(mi) * 60 + Number(se) + Number(ms) / 1000
}

// Parser de .srt básico: índice / rango de tiempo / texto (una o más líneas),
// bloques separados por línea en blanco. Suficiente para lo que vamos a
// mostrar — no soporta WebVTT ni estilos avanzados, solo el <i>/<b> más común
// (los saca, no los renderiza).
export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = []
  const blocks = content.replace(/\r/g, '').trim().split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIdx === -1) continue
    const [startStr, endStr] = lines[timeLineIdx].split('-->').map((s) => s.trim())
    const start = parseSrtTime(startStr)
    const end = parseSrtTime(endStr)
    const text = lines.slice(timeLineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text && end > start) cues.push({ start, end, text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

// Búsqueda binaria de la cue activa en `position` — cues vienen ordenadas por
// start. O(log n), corre en cada tick de progreso (cada ~500ms).
export function findActiveCue(cues: SrtCue[], position: number): SrtCue | null {
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = cues[mid]
    if (position < c.start) hi = mid - 1
    else if (position > c.end) lo = mid + 1
    else return c
  }
  return null
}
