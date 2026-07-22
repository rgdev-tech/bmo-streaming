// Parseo y ranking de los streams que devuelve Torrentio.
//
// Módulo PURO a propósito: sin fetch, sin process.env, sin import de red. Toda
// la lógica de decisión (qué archivo es reproducible, cuál es mejor, cuál hay
// que descartar) vive acá para poder testearla sin tocar la red — Torrentio
// solo responde a IPs de Vercel, así que un test que dependa de él es
// imposible de correr en local o en CI.
//
// El objetivo del ranking es un iPhone reproduciendo por datos móviles, NO la
// mejor calidad absoluta. Ver scoreStream() para el detalle de cada peso.

export type TorrentioStream = {
  name?: string
  title?: string
  infoHash?: string
  fileIdx?: number
  url?: string
  behaviorHints?: { filename?: string; bingeGroup?: string }
}

// Tres estados, NO un boolean. `null` = "no pudimos leer el marcador", que es
// muy distinto de "no está cacheado". Colapsar null→false haría que el día que
// Torrentio cambie el formato descartemos todos los candidatos y Real-Debrid
// deje de usarse por completo. Ver cacheSignalHealth().
export type CacheState = true | false | null

export type AudioTag =
  | 'latino' | 'castellano' | 'spanish'
  | 'english' | 'italian' | 'french' | 'portuguese'

// Procedencia del release. Es independiente de la resolución: un "1080p" puede
// ser una grabación de cine (CAM/PRE-HD) que se ve horrible. En estrenos
// recientes estos rips abundan y sin esto ganaban por tener buen bitrate.
export type ReleaseKind = 'cam' | 'screener' | 'hdtv' | 'web' | 'bluray' | null

export type ParsedStream = {
  raw: TorrentioStream
  filename: string
  resolution: 2160 | 1080 | 720 | 480 | null
  codec: 'av1' | 'hevc' | 'h264' | 'xvid' | null
  bitDepth: 8 | 10 | null
  hdr: 'none' | 'hdr10' | 'hdr10plus' | 'dv'
  isRemux: boolean
  isUpscale: boolean
  releaseKind: ReleaseKind
  sizeGB: number | null
  seeders: number | null
  cached: CacheState
  year: number | null
  season: number | null
  episode: number | null
  isSeasonPack: boolean
  langs: Set<AudioTag>
  resolveUrl: string | null
}

// Lo que sabemos del título por TMDB, para validar que el torrent sea el
// correcto. `title` viene localizado (la API pide es-ES) y `originalTitle` en
// el idioma original — tener los dos evita rechazar releases traducidos.
export type MediaRef = {
  type: 'movie' | 'tv'
  title: string
  originalTitle: string | null
  originalLanguage: string | null
  // Película: año de estreno. Serie: año del EPISODIO pedido, no de la serie
  // (usar el de la serie rechazaría cualquier temporada posterior a la 1).
  year: number | null
  runtimeMin: number | null
  season?: number
  episode?: number
}

export type Rejection =
  | 'no-url' | 'not-video' | 'av1'
  | 'wrong-year' | 'wrong-season' | 'wrong-episode'

export type ScoredCandidate = {
  parsed: ParsedStream
  score: number
  // Desglose por término. Los tests afirman sobre términos individuales en vez
  // de sobre un total mágico, y debugTorrentio lo expone para poder ver POR QUÉ
  // ganó un archivo sin tener que reproducir el cálculo a mano.
  parts: Record<string, number>
}

// ── Parsers ─────────────────────────────────────────────────────────────────

// Torrentio marca el estado en Real-Debrid en el campo `name`, algo como
// "[RD+] Torrentio\n1080p" (cacheado) o "[RD download] ..." (habría que
// descargarlo). Aceptamos varios debrids (RD/AD/PM/...) y varios marcadores
// porque el formato exacto no está documentado y no se puede verificar sin
// desplegar. Ante cualquier duda devolvemos null en vez de adivinar.
const CACHE_RE = /\[\s*(?:RD|AD|PM|DL|OC|TB)(\+|⚡|\s*download|\s*dl)?\s*\]/i

export function parseCacheState(name?: string): CacheState {
  const m = CACHE_RE.exec(name ?? '')
  if (!m) return null
  const marker = (m[1] ?? '').trim().toLowerCase()
  if (marker === '+' || marker === '⚡') return true
  if (marker === 'download' || marker === 'dl') return false
  return null // "[RD]" pelado: ambiguo, no inventamos
}

// ¿Podemos confiar en la señal de cacheado del lote?
//  - 'absent':  no se parseó ni un marcador → Torrentio cambió el formato
//  - 'uniform': todos idénticos → la señal no discrimina, no filtra nada
//  - 'ok':      hay mezcla → se puede filtrar con confianza
// El caller usa esto para degradar en vez de quedarse sin candidatos.
export function cacheSignalHealth(parsed: ParsedStream[]): 'ok' | 'absent' | 'uniform' {
  const known = parsed.filter((p) => p.cached !== null)
  if (known.length === 0) return 'absent'
  const anyTrue = known.some((p) => p.cached === true)
  const anyFalse = known.some((p) => p.cached === false)
  return anyTrue && anyFalse ? 'ok' : 'uniform'
}

// Un año suelto en un nombre de archivo es traicionero: "Blade Runner 2049",
// "1917", "2012" son TÍTULOS que parecen años. Por eso exigimos delimitadores,
// preferimos el que está entre paréntesis, y si hay varios candidatos nos
// quedamos con el ÚLTIMO (el título va primero, el año del release después).
const YEAR_PAREN_RE = /[([](19\d{2}|20\d{2})[)\]]/g
const YEAR_LOOSE_RE = /(?:^|[.\s_\-])(19\d{2}|20\d{2})(?=$|[.\s_\-])/g

export function parseYear(text: string, now = new Date()): number | null {
  const maxYear = now.getFullYear() + 1
  const pick = (re: RegExp): number | null => {
    let last: number | null = null
    for (const m of text.matchAll(re)) {
      const y = Number(m[1])
      if (y >= 1900 && y <= maxYear) last = y
    }
    return last
  }
  return pick(YEAR_PAREN_RE) ?? pick(YEAR_LOOSE_RE)
}

// Los season packs ("S05.COMPLETE") suelen ser las fuentes mejor sembradas y
// más veces cacheadas: devuelven episode:null y Torrentio resuelve el episodio
// concreto vía fileIdx. Rechazarlos por "no coincide el episodio" sería tirar
// las mejores fuentes de series.
const SXXEYY_RE = /\bS(\d{1,2})[\s._-]?E(\d{1,3})\b/i
const NXNN_RE = /\b(\d{1,2})x(\d{2,3})\b/i
const SEASON_ONLY_RE = /\b(?:S(\d{1,2})\b(?![\s._-]?E)|Season[\s._-]?(\d{1,2})\b)/i

export function parseEpisodeTag(
  text: string
): { season: number | null; episode: number | null; isSeasonPack: boolean } {
  const se = SXXEYY_RE.exec(text) ?? NXNN_RE.exec(text)
  if (se) return { season: Number(se[1]), episode: Number(se[2]), isSeasonPack: false }
  const s = SEASON_ONLY_RE.exec(text)
  if (s) return { season: Number(s[1] ?? s[2]), episode: null, isSeasonPack: true }
  return { season: null, episode: null, isSeasonPack: false }
}

// Torrentio pone el tamaño en `title`, tipo "👤 45 💾 1.4 GB ⚙️ TPB".
// Acepta MB además de GB — un rip de 850 MB antes no matcheaba y quedaba sin
// puntuar ni penalizar.
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(GB|MB)\b/i
const SEEDERS_RE = /👤\s*(\d+)/

export function parseSize(text: string): number | null {
  const m = SIZE_RE.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2].toUpperCase() === 'MB' ? n / 1024 : n
}

export function parseSeeders(text: string): number | null {
  const m = SEEDERS_RE.exec(text)
  return m ? Number(m[1]) : null
}

// Idioma del audio. Dos fuentes: tokens en el nombre y emoji de bandera (que
// Torrentio deriva de las pistas reales del torrent, así que son más fiables
// que el texto).
//
// Latino y castellano se mantienen SEPARADOS a propósito: son doblajes
// distintos y los grupos los taggean aparte justamente para diferenciarlos.
// Tratarlos como sinónimos hacía que pidiendo latino cayera un castellano.
//
// Los \b son obligatorios: sin ellos "TRANSLATED" y "Platinum" matchean "lat".
const LANG_PATTERNS: [AudioTag, RegExp][] = [
  ['latino', /\b(?:latino|latinoamerican[oa]|latin|latam|lat|esp[\s._-]?lat|spa[\s._-]?lat|dual[\s._-]?lat|audio[\s._-]?lat(?:ino)?|doblad[oa]|doblaje|es[\s._-]?419)\b|🇲🇽|🇦🇷|🇨🇴|🇨🇱|🇵🇪|🇻🇪|🇪🇨|🇧🇴|🇩🇴|🇺🇾|🇵🇾|🇬🇹/i],
  ['castellano', /\b(?:castellano|cast)\b|🇪🇸/i],
  ['spanish', /\b(?:spanish|espanol|español|spa|esp)\b/i],
  ['english', /\b(?:english|eng|ing)\b|🇬🇧|🇺🇸/i],
  ['italian', /\b(?:italian|ita)\b|🇮🇹/i],
  ['french', /\b(?:french|fre|fra|vff|vostfr)\b|🇫🇷/i],
  ['portuguese', /\b(?:portuguese|por|pt[\s._-]?br|dublado)\b|🇧🇷|🇵🇹/i],
]

export function parseLangs(text: string): Set<AudioTag> {
  const out = new Set<AudioTag>()
  for (const [tag, re] of LANG_PATTERNS) if (re.test(text)) out.add(tag)
  // "Latino"/"Castellano" implican español sin decirlo con esa palabra.
  if (out.has('latino') || out.has('castellano')) out.add('spanish')
  return out
}

// Lista NEGRA, no blanca: se rechaza solo ante evidencia POSITIVA de que no es
// video (un .rar, un .iso). Con lista blanca se caían ~10% de candidatos por
// título, porque Torrentio a veces no da `behaviorHints.filename` y la primera
// línea de `title` es un nombre de display sin extensión — un torrent perfecto
// que descartábamos por no poder leerle la extensión.
const NON_VIDEO_EXT_RE = /\.(?:rar|zip|7z|iso|exe|nfo|txt|srt|sub|idx|jpe?g|png)$/i

// Grabaciones de sala y pre-estrenos: se ven mal a cualquier resolución.
// "TS" a secas no se usa: choca con DTS y con la extensión .ts.
const CAM_RE = /\b(?:cam|hdcam|camrip|hdts|telesync|telecine|hdtc|pre[\s._-]?hd|pre[\s._-]?dvd)\b/i
const SCREENER_RE = /\b(?:scr|screener|dvdscr|r5)\b/i

function parseReleaseKind(text: string): ReleaseKind {
  if (CAM_RE.test(text)) return 'cam'
  if (SCREENER_RE.test(text)) return 'screener'
  if (/\b(?:blu[\s._-]?ray|bdrip|brrip|bdremux|remux|bdmux)\b/i.test(text)) return 'bluray'
  if (/\b(?:web[\s._-]?dl|web[\s._-]?rip|webrip|amzn|nf|dsnp|web)\b/i.test(text)) return 'web'
  if (/\bhdtv\b/i.test(text)) return 'hdtv'
  return null
}

export function parseStream(s: TorrentioStream): ParsedStream {
  // Torrentio omite behaviorHints.filename en algunos torrents de archivo
  // único; ahí la primera línea de `title` ES el nombre del archivo. Sin este
  // fallback esos candidatos se descartaban en silencio.
  const filename = s.behaviorHints?.filename?.trim() || (s.title ?? '').split('\n')[0].trim()
  const text = `${s.title ?? ''} ${filename}`
  const ep = parseEpisodeTag(text)

  const hdr: ParsedStream['hdr'] =
    /\bdolby[\s._-]?vision\b|\bdv\b/i.test(text) ? 'dv'
    : /\bhdr10\+|\bhdr10plus\b/i.test(text) ? 'hdr10plus'
    : /\bhdr\b|\bhdr10\b|\bpq\b/i.test(text) ? 'hdr10'
    : 'none'

  const codec: ParsedStream['codec'] =
    /\bav1\b/i.test(text) ? 'av1'
    : /\b(?:x265|h\.?265|hevc)\b/i.test(text) ? 'hevc'
    : /\b(?:x264|h\.?264|avc)\b/i.test(text) ? 'h264'
    : /\b(?:xvid|divx)\b/i.test(text) ? 'xvid'
    : null

  // Lookarounds de dígito en vez de \b: los grupos pegan los tokens sin
  // separador ("4Kreescalado2160") y con \b no se detectaba nada. Excluir solo
  // dígitos adyacentes evita además confundir "H265" o "x264" con una
  // resolución, y deja pasar "1920x1080".
  const resolution: ParsedStream['resolution'] =
    /(?<!\d)2160(?!\d)|(?<![a-z0-9])4k|(?<![a-z0-9])uhd(?![a-z])/i.test(text) ? 2160
    : /(?<!\d)1080(?!\d)/i.test(text) ? 1080
    : /(?<!\d)720(?!\d)/i.test(text) ? 720
    : /(?<!\d)480(?!\d)/i.test(text) ? 480
    : null

  return {
    raw: s,
    filename,
    resolution,
    codec,
    bitDepth: /\b10[\s._-]?bits?\b/i.test(text) ? 10 : /\b8[\s._-]?bits?\b/i.test(text) ? 8 : null,
    hdr,
    isRemux: /\bremux\b/i.test(text),
    releaseKind: parseReleaseKind(text),
    // "4Kreescalado", "upscaled": 4K falso hecho a partir de un 1080p. Pesa
    // como 4K y no aporta nada de calidad.
    isUpscale: /reescalad|upscal|re[\s._-]?scaled/i.test(text),
    sizeGB: parseSize(text),
    seeders: parseSeeders(text),
    cached: parseCacheState(s.name),
    year: parseYear(text),
    season: ep.season,
    episode: ep.episode,
    isSeasonPack: ep.isSeasonPack,
    langs: parseLangs(text),
    resolveUrl: s.url ?? null,
  }
}

// ── Rechazos duros ──────────────────────────────────────────────────────────

// Normaliza para comparar títulos: sin acentos, sin puntuación, minúsculas.
function normalizeTitle(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titleOverlap(filename: string, m: MediaRef): number {
  const hay = ' ' + normalizeTitle(filename) + ' '
  const score = (title: string): number => {
    // Palabras de 3+ letras: las cortas ("de", "la", "el") dan falsos positivos.
    const words = normalizeTitle(title).split(' ').filter((w) => w.length >= 3)
    if (!words.length) return 1 // título impossible de tokenizar → no penalizar
    const hits = words.filter((w) => hay.includes(` ${w} `)).length
    return hits / words.length
  }
  return Math.max(score(m.title), m.originalTitle ? score(m.originalTitle) : 0)
}

// SOLO descartes categóricos: contenido equivocado o imposible de reproducir.
// Todo lo demás (calidad, tamaño, idioma) es preferencia y va al score.
export function rejectionOf(p: ParsedStream, m: MediaRef): Rejection | null {
  if (!p.resolveUrl) return 'no-url'
  if (NON_VIDEO_EXT_RE.test(p.filename)) return 'not-video'

  // AV1 no tiene decodificación por hardware en iPhone salvo A17 Pro y
  // posteriores; por software un 4K AV1 es imposible en un teléfono. Reproduce
  // negro o directamente falla, así que no es una preferencia: es inservible.
  if (p.codec === 'av1') return 'av1'

  if (m.type === 'tv') {
    // Nada de validar año en series: el año del archivo es el de emisión del
    // episodio, que en temporadas tardías difiere años del de la serie.
    if (m.season != null && p.season != null && p.season !== m.season) return 'wrong-season'
    // Los season packs delegan el episodio a fileIdx → no se valida.
    if (m.episode != null && p.episode != null && !p.isSeasonPack && p.episode !== m.episode) {
      return 'wrong-episode'
    }
    return null
  }

  // Película: el año es la señal fiable de "esta es otra peli". Solo se rechaza
  // si el archivo TIENE año parseable y no coincide — muchos releases legítimos
  // no traen año (p.ej. "El club de la Lucha 4Kreescalado2160.mkv").
  if (m.year != null && p.year != null && Math.abs(p.year - m.year) > 1) return 'wrong-year'
  return null
}

// ── Score ───────────────────────────────────────────────────────────────────

export function bitrateMbps(sizeGB: number | null, runtimeMin: number | null): number | null {
  if (sizeGB == null || !runtimeMin) return null
  return (sizeGB * 8192) / (runtimeMin * 60)
}

// Penalización de DECODIFICACIÓN: es un término de interacción, no la suma de
// penalizar resolución y códec por separado. 1080p HEVC 10-bit va perfecto en
// cualquier iPhone; 2160p HEVC 10-bit en MKV no, porque VLCKit no rutea de
// forma confiable HEVC-en-MKV por VideoToolbox y por software se cae a pedazos.
// Modelarlo aditivo haría que 2160p-HEVC-10bit le gane a 1080p-x264 con solo
// desafinar un poco el peso de la resolución.
export function decodePenalty(
  resolution: ParsedStream['resolution'],
  codec: ParsedStream['codec'],
  bitDepth: ParsedStream['bitDepth']
): number {
  if (resolution !== 2160) return codec === 'hevc' && bitDepth === 10 ? -2 : 0
  if (codec === 'hevc') return bitDepth === 10 ? -45 : -30
  if (codec === 'h264') return -20 // 4K x264 = bitrate altísimo
  return -35
}

export function scoreStream(p: ParsedStream, m: MediaRef, lang: 'original' | 'latino'): ScoredCandidate {
  const parts: Record<string, number> = {}

  // Ya cacheado en Real-Debrid = arranca al instante. Peso alto pero no
  // infinito: el filtro duro de cacheados vive aparte (ver rankCandidates).
  parts.cached = p.cached === true ? 120 : 0

  if (lang === 'latino') {
    // Un dual/multi-audio con español suele ser un release de mejor calidad que
    // un re-encode solo-latino, y el cliente ya sabe auto-seleccionar la pista
    // en español de las pistas embebidas. Por eso puntúa casi igual.
    // El idioma es un DESEMPATE SUAVE, no un factor dominante. La prioridad es la
    // reproducción INSTANTÁNEA: entre fuentes cacheadas (todas arrancan al toque)
    // preferimos español/latino cuando la calidad es comparable, pero JAMÁS por
    // encima de resolución/bitrate. Los pesos van por debajo del salto de
    // resolución (1080↔480 = 35) para no elegir un latino 480p sobre un original
    // 1080p. "Español" ambiguo (sin decir latino ni castellano) suele ser latino,
    // así que va por encima del castellano (doblaje de España).
    parts.lang = p.langs.has('latino') ? 25
      : p.langs.has('spanish') && !p.langs.has('castellano') ? 15
      : p.langs.has('castellano') ? 8
      : 0
  } else {
    // Pedimos audio original: penalizamos releases que claramente NO lo traen
    // (el caso "Superman 2160p iTA EnG": ganaba un release italiano).
    const orig = m.originalLanguage
    const tagFor: Record<string, AudioTag> = { en: 'english', it: 'italian', fr: 'french', pt: 'portuguese', es: 'spanish' }
    const wanted = orig ? tagFor[orig] : undefined
    parts.lang = wanted && p.langs.size > 0 && !p.langs.has(wanted) ? -60 : 0
  }

  // Título: penalización, NUNCA rechazo. Los releases usan abreviaturas y
  // títulos traducidos, así que un solapamiento bajo es sospecha, no certeza.
  parts.title = titleOverlap(p.filename, m) === 0 ? -80 : 0

  // Resolución invertida respecto de lo habitual: el objetivo es un teléfono
  // por datos móviles, donde 1080p es el punto dulce y 4K es un lastre.
  parts.resolution =
    p.resolution === 1080 ? 40
    : p.resolution === 720 ? 25
    : p.resolution === 2160 ? 10
    : p.resolution === 480 ? 5
    : 5

  parts.decode = decodePenalty(p.resolution, p.codec, p.bitDepth)

  // HDR penaliza porque el player usa VLCKit para estas fuentes (ver
  // `isVlcSource` en apps/client/app/player.tsx) y VLCKit no hace tone mapping
  // de PQ en iOS: el HDR10 se ve lavado y Dolby Vision perfil 5 peor todavía
  // (no tiene capa base compatible con HDR10). Con AVPlayer esto NO aplicaría.
  parts.hdr = p.hdr === 'dv' ? -25 : p.hdr === 'hdr10plus' ? -15 : p.hdr === 'hdr10' ? -12 : 0

  parts.upscale = p.isUpscale ? -60 : 0
  parts.remux = p.isRemux ? -40 : 0

  // Procedencia. Un CAM/PRE-HD "1080p" con buen bitrate se colaba al tope
  // (caso real: un "HQ PRE-HD" ganaba en Superman 2025) porque ningún otro
  // término mira de dónde salió la copia.
  parts.release =
    p.releaseKind === 'cam' ? -120
    : p.releaseKind === 'screener' ? -90
    : p.releaseKind === 'hdtv' ? -10
    : 0

  // Bitrate, no tamaño: 20 GB en 90 min (~30 Mbps) y 20 GB en 3 h (~15 Mbps)
  // son cosas muy distintas para una conexión móvil.
  const br = bitrateMbps(p.sizeGB, m.runtimeMin)
  if (br != null) {
    parts.bitrate = br <= 4 ? 15 : br <= 8 ? 0 : br <= 15 ? -25 : -50
  } else if (p.sizeGB != null) {
    parts.bitrate = p.sizeGB > 20 ? -40 : p.sizeGB > 10 ? -20 : p.sizeGB > 6 ? -8 : 5
  } else {
    parts.bitrate = 0
  }

  parts.seeders = p.seeders ? Math.min(10, Math.log2(p.seeders + 1)) : 0

  const score = Object.values(parts).reduce((a, b) => a + b, 0)
  return { parsed: p, score, parts }
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export type RankResult = {
  ranked: ScoredCandidate[]
  rejected: { label: string; reason: Rejection }[]
  hasLatinoAlternative: boolean
  cacheSignal: 'ok' | 'absent' | 'uniform'
  cacheCounts: { cached: number; uncached: number; unknown: number }
}

export function rankCandidates(
  streams: TorrentioStream[],
  m: MediaRef,
  lang: 'original' | 'latino'
): RankResult {
  const parsed = streams.map(parseStream)
  const rejected: { label: string; reason: Rejection }[] = []
  const kept: ParsedStream[] = []

  for (const p of parsed) {
    const reason = rejectionOf(p, m)
    if (reason) rejected.push({ label: p.filename || '(sin nombre)', reason })
    else kept.push(p)
  }

  // Se calcula sobre los SUPERVIVIENTES (no sobre los crudos): así no le
  // ofrecemos al usuario "cambiar a latino" si la única opción latina era un
  // AV1 que igual no iba a reproducir. Pero sí se lo ofrecemos cuando existe y
  // simplemente puntuó bajo.
  // Cuenta latino explícito y "Español" ambiguo (probable latino), no castellano:
  // el botón "cambiar a latino" del cliente debe aparecer también cuando hay un
  // release en español sin la palabra "Latino" (que antes quedaba invisible).
  const hasLatinoAlternative = kept.some(
    (p) => p.langs.has('latino') || (p.langs.has('spanish') && !p.langs.has('castellano'))
  )

  const cacheSignal = cacheSignalHealth(kept)
  const cacheCounts = {
    cached: kept.filter((p) => p.cached === true).length,
    uncached: kept.filter((p) => p.cached === false).length,
    unknown: kept.filter((p) => p.cached === null).length,
  }

  const ranked = kept
    .map((p) => scoreStream(p, m, lang))
    .sort((a, b) => b.score - a.score)

  return { ranked, rejected, hasLatinoAlternative, cacheSignal, cacheCounts }
}

// Filtro de cacheados, con degradación segura.
//
// Resolver un torrent NO cacheado le ordena a Real-Debrid empezar a
// descargarlo: consume la cuota del usuario y le llena la librería. Y como
// prewarmTitle dispara un resolve en cada press-in de póster, navegar el home
// bastaría para ensuciar la cuenta. Por eso los no cacheados no se tocan.
//
// La degradación se dispara SOLO con 'absent' (no se pudo leer ni un marcador,
// o sea Torrentio cambió el formato): ahí filtrar dejaría cero candidatos y
// Real-Debrid quedaría inutilizado en silencio, así que preferimos el
// comportamiento previo y un log fuerte.
//
// 'uniform' NO degrada: que todos los supervivientes sean no-cacheados es una
// respuesta legible y legítima, no una señal rota. Devolver la lista completa
// ahí sería correr justamente los torrents que no queremos tocar. Con cero
// cacheados devolvemos vacío → el caller da null → scrape() cae a los scrapers.
export function selectRunnable(r: RankResult): ScoredCandidate[] {
  if (r.cacheSignal === 'absent') return r.ranked
  return r.ranked.filter((c) => c.parsed.cached === true)
}
