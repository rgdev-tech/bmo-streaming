// Utilidades puras para manipular playlists HLS y subtítulos.
// Sin dependencias del servidor → fácilmente testeable.

// Mapea el nombre de idioma de vidlink a código ISO para el atributo LANGUAGE
export function langCode(language: string): string {
  const l = language.toLowerCase()
  if (l.includes('spanish') || l.includes('español') || l.includes('castellano')) return 'es'
  if (l.includes('english')) return 'en'
  if (l.includes('portuguese') || l.includes('português')) return 'pt'
  if (l.includes('french') || l.includes('français')) return 'fr'
  if (l.includes('german') || l.includes('deutsch')) return 'de'
  if (l.includes('italian')) return 'it'
  if (l.includes('japanese')) return 'ja'
  if (l.includes('korean')) return 'ko'
  if (l.includes('chinese') || l.includes('mandarin')) return 'zh'
  if (l.includes('russian')) return 'ru'
  if (l.includes('arabic')) return 'ar'
  return 'und'
}

export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r+/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}`
}

// Extrae el BANDWIDTH de una línea #EXT-X-STREAM-INF (0 si no tiene)
export function bandwidthOf(streamInf: string): number {
  const m = streamInf.match(/BANDWIDTH=(\d+)/)
  return m ? Number(m[1]) : 0
}

/**
 * Reescribe el master playlist:
 *  1. Inyecta las pistas de subtítulos tras #EXTM3U.
 *  2. Reordena las variantes de video por BANDWIDTH descendente, para que
 *     el reproductor arranque en la MÁXIMA calidad (en vez de la más baja).
 *  3. Añade SUBTITLES="subs" a cada variante si hay subtítulos.
 */
export function rewriteMaster(orig: string, subLines: string[]): string {
  const lines = orig.split('\n')

  // Si no es un master con variantes, se sirve casi tal cual (solo subs)
  if (!orig.includes('#EXT-X-STREAM-INF')) {
    if (!subLines.length) return orig
    const out: string[] = []
    for (const line of lines) {
      out.push(line)
      if (line.startsWith('#EXTM3U')) out.push(...subLines)
    }
    return out.join('\n')
  }

  const header: string[] = []
  const variants: { inf: string; uri: string; bw: number }[] = []

  let i = 0
  while (i < lines.length && !lines[i].startsWith('#EXT-X-STREAM-INF')) {
    header.push(lines[i])
    i++
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const inf = subLines.length ? `${line},SUBTITLES="subs"` : line
      let j = i + 1
      while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) j++
      const uri = lines[j] ?? ''
      variants.push({ inf, uri, bw: bandwidthOf(line) })
      i = j + 1
    } else {
      i++
    }
  }

  variants.sort((a, b) => b.bw - a.bw)

  const out: string[] = []
  for (const line of header) {
    out.push(line)
    if (line.startsWith('#EXTM3U') && subLines.length) out.push(...subLines)
  }
  for (const v of variants) {
    out.push(v.inf)
    out.push(v.uri)
  }
  return out.join('\n')
}
