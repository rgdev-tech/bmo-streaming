// Elección del subtítulo, emparejado contra el ARCHIVO que se va a reproducir.
//
// Wyzie devuelve decenas de subtítulos por idioma ordenados por su propia
// relevancia, que no sabe nada del archivo que terminó sirviendo Real-Debrid.
// Quedarse con los tres primeros era una lotería: para Fight Club el primer
// español es de un "BluRay.1080p.DTS.x264-EuReKA" mientras RD sirve un
// "REMASTERED.1080p.BluRay.x265", y para Superman el primero es un rip WEB
// mientras RD sirve un BluRay. Release distinto = tiempos distintos = el
// subtítulo entra corrido. De ahí que "casi siempre vienen descuadrados".
//
// Acá se rankea cada candidato por afinidad con el nombre del archivo real y se
// deja arriba el que más probablemente esté sincronizado. Módulo puro: sin red,
// sin estado, testeable de a un caso.

export type SubCandidate = {
  lang: string              // código ISO corto que reporta Wyzie ('es', 'en', 'pt')
  display: string           // etiqueta legible ("Spanish")
  type: string              // 'srt' | 'vtt'
  url: string
  release: string           // release + fileName concatenados, para el matching
  origin: string            // "BluRay" | "WEB" | … tal cual lo reporta Wyzie
  downloadCount: number
  hearingImpaired: boolean
  ai: boolean
}

export type PickedCaption = {
  language: string
  url: string
  type: string
  altUrls?: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Grupo de release: el token final tras el último guión ("-EuReKA", "-FGT",
// "-CiNEPHiLES"). Es la señal más fuerte que existe: mismo grupo = mismo corte
// y, casi siempre, los mismos tiempos.
export function releaseGroup(text: string): string | null {
  const noExt = text.replace(/\.(?:mkv|mp4|avi|ts|m2ts|mov|webm|srt)$/i, '')
  // Los .srt suelen colgar sufijos cortos DESPUÉS del grupo
  // ("…dxva-EuReKA.SPA"), así que el grupo no siempre queda al final.
  const m = noExt.match(/-([a-z0-9]{2,20})(?:\.[a-z0-9]{1,5})*\s*(?:\[[^\]]*\])?$/i)
  if (!m) return null
  const g = m[1].toLowerCase()
  // "x264-1", "5.1" y demás sufijos numéricos no son grupos.
  return /^\d+$/.test(g) ? null : g
}

// Procedencia del material. Un subtítulo de un WEB-DL contra un BluRay arranca
// con distinto largo de logos/intro: es la causa más común del desfase.
export function originKind(text: string): 'bluray' | 'web' | 'hdtv' | 'dvd' | null {
  const t = text.toLowerCase()
  if (/\b(?:blu[\s._-]?ray|bluray|bdrip|brrip|bdremux|bd|remux)\b/.test(t)) return 'bluray'
  if (/\b(?:web[\s._-]?dl|webrip|web|amzn|nf|dsnp|hmax|atvp|itunes|it)\b/.test(t)) return 'web'
  if (/\bhdtv\b/.test(t)) return 'hdtv'
  if (/\b(?:dvdrip|dvd)\b/.test(t)) return 'dvd'
  return null
}

// Cortes alternativos. Cambian la DURACIÓN de la película, así que un subtítulo
// de otro corte no se arregla con un offset fijo: está mal a lo largo de todo
// el archivo. Por eso el desajuste pesa más que cualquier otra señal.
const EDITION_RE = /\b(?:remaster(?:ed)?|extended|unrated|directors?[\s._-]?cut|theatrical|uncut|anniversary|redux|final[\s._-]?cut|ultimate)\b/gi

export function editions(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(EDITION_RE)) out.add(norm(m[0]).replace(/\s+/g, ''))
  return out
}

function resolutionOf(text: string): string | null {
  const m = text.match(/(?<!\d)(2160|1080|720|480)(?!\d)/)
  return m ? m[1] : null
}

function codecOf(text: string): 'hevc' | 'h264' | null {
  if (/\b(?:x265|h\.?265|hevc)\b/i.test(text)) return 'hevc'
  if (/\b(?:x264|h\.?264|avc)\b/i.test(text)) return 'h264'
  return null
}

// Español rioplatense/latino frente al de España. La app arranca en 'latino'
// por defecto (ver getAudioLang), así que ante dos subtítulos igual de bien
// emparejados se prefiere el latino.
const LATINO_RE = /\b(?:latino|latinoamerican[oa]|latam|es[\s._-]?419|espanol[\s._-]?latino|spanish[\s._-]?la)\b/i
const CASTELLANO_RE = /\b(?:castellano|espana|european[\s._-]?spanish|espanol[\s._-]?europeo|iberian)\b/i

// Se comparan SIN acentos: Wyzie mezcla "Español europeo", "Espanol Europeo" y
// "European Spanish" en el mismo campo, y con la ñ/tilde literal se escapaban
// justo las etiquetas escritas en castellano.
const deaccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function spanishFlavor(text: string): 'latino' | 'castellano' | null {
  const t = deaccent(text)
  if (LATINO_RE.test(t)) return 'latino'
  if (CASTELLANO_RE.test(t)) return 'castellano'
  return null
}

/**
 * Cuánto se parece el release de un subtítulo al archivo de video. Positivo =
 * probablemente sincronizado. Sin nombre de archivo devuelve 0 para todos y el
 * orden queda decidido por los desempates (idioma/popularidad).
 */
export function releaseAffinity(subText: string, videoFilename: string | null): number {
  if (!videoFilename) return 0
  let score = 0

  // Mismo nombre base = mismo archivo. No hay señal mejor.
  const base = (s: string) => norm(s.replace(/\.(?:mkv|mp4|avi|srt|ts)$/i, ''))
  if (base(subText).includes(base(videoFilename)) || base(videoFilename).includes(base(subText))) {
    score += 60
  }

  const gSub = releaseGroup(subText)
  const gVid = releaseGroup(videoFilename)
  if (gSub && gVid) score += gSub === gVid ? 40 : -5

  const oSub = originKind(subText)
  const oVid = originKind(videoFilename)
  if (oSub && oVid) score += oSub === oVid ? 20 : -20

  // Un corte distinto desincroniza de forma irreparable: pesa más que el resto.
  const eSub = editions(subText)
  const eVid = editions(videoFilename)
  const sameEditions = eSub.size === eVid.size && [...eSub].every((e) => eVid.has(e))
  if (!sameEditions) score -= 30

  const rSub = resolutionOf(subText)
  const rVid = resolutionOf(videoFilename)
  if (rSub && rVid) score += rSub === rVid ? 8 : -4

  const cSub = codecOf(subText)
  const cVid = codecOf(videoFilename)
  if (cSub && cVid) score += cSub === cVid ? 8 : -4

  return score
}

// Puntaje final de un candidato: afinidad con el archivo primero, y recién
// después las preferencias (latino, subtítulo limpio, popularidad).
export function scoreCandidate(c: SubCandidate, videoFilename: string | null): number {
  let score = releaseAffinity(`${c.release} ${c.origin}`, videoFilename)

  if (c.lang === 'es') {
    const flavor = spanishFlavor(c.release)
    if (flavor === 'latino') score += 15
    else if (flavor === 'castellano') score -= 5
  }

  if (c.hearingImpaired) score -= 6   // los SDH agregan acotaciones de sonido
  if (c.ai) score -= 8                // transcripción automática: peor redacción

  // Popularidad como desempate suave, nunca como criterio principal: un
  // subtítulo muy bajado pero de otro release sigue estando corrido.
  score += Math.min(10, Math.log10(Math.max(1, c.downloadCount)) * 2)

  return score
}

/**
 * Un Caption por idioma, con las mejores alternativas como respaldo.
 *
 * El cliente prueba `url` y va cayendo por `altUrls` hasta que uno parsea, así
 * que este orden ES la elección: el primero debería ser el que mejor encaja con
 * el archivo. `perLang` acota cuántos se mandan (el resto sería peso muerto en
 * la respuesta).
 */
export function pickCaptions(
  cands: SubCandidate[],
  videoFilename: string | null,
  perLang = 3
): PickedCaption[] {
  const byLang = new Map<string, SubCandidate[]>()
  for (const c of cands) {
    if (!c.url || !c.lang) continue
    const list = byLang.get(c.lang)
    if (list) list.push(c)
    else byLang.set(c.lang, [c])
  }

  const out: PickedCaption[] = []
  for (const [, list] of byLang) {
    const ranked = list
      .map((c) => ({ c, s: scoreCandidate(c, videoFilename) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, perLang)
      .map((x) => x.c)
    if (!ranked.length) continue
    out.push({
      language: ranked[0].display,
      type: ranked[0].type,
      url: ranked[0].url,
      altUrls: ranked.slice(1).map((c) => c.url),
    })
  }
  return out
}
