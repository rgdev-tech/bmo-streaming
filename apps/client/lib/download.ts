import * as FileSystem from 'expo-file-system'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_URL } from './api'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type DownloadStatus = 'pending' | 'downloading' | 'done' | 'error' | 'paused'

export type DownloadItem = {
  key: string              // e.g. "movie-550" | "tv-1396-1-1"
  id: number
  media_type: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path?: string | null
  season?: number
  episode?: number
  episodeTitle?: string
  status: DownloadStatus
  progress: number         // 0-1
  quality: string
  totalSegments: number
  downloadedSegments: number
  localPath?: string       // path al m3u8 local (cuando status=done)
  error?: string
  addedAt: number
  size?: number            // bytes (estimado)
}

// ── Persistencia ─────────────────────────────────────────────────────────────

const META_KEY = 'bmo:downloads'
const DOWNLOADS_DIR = FileSystem.documentDirectory + 'downloads/'

let _cache: Map<string, DownloadItem> | null = null
const _listeners = new Set<() => void>()

function notify() { _listeners.forEach(fn => fn()) }

export function onDownloadsChange(fn: () => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

async function loadMeta(): Promise<Map<string, DownloadItem>> {
  if (_cache) return _cache
  try {
    const raw = await AsyncStorage.getItem(META_KEY)
    const arr: DownloadItem[] = raw ? JSON.parse(raw) : []
    _cache = new Map(arr.map(d => [d.key, d]))
  } catch {
    _cache = new Map()
  }
  return _cache
}

async function saveMeta() {
  if (!_cache) return
  const arr = [..._cache.values()]
  await AsyncStorage.setItem(META_KEY, JSON.stringify(arr))
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function getDownloads(): Promise<DownloadItem[]> {
  const map = await loadMeta()
  return [...map.values()].sort((a, b) => b.addedAt - a.addedAt)
}

export async function getDownload(key: string): Promise<DownloadItem | undefined> {
  const map = await loadMeta()
  return map.get(key)
}

export function downloadKey(id: number, type: 'movie' | 'tv', season?: number, episode?: number) {
  return type === 'tv' ? `tv-${id}-${season}-${episode}` : `movie-${id}`
}

export async function isDownloaded(id: number, type: 'movie' | 'tv', season?: number, episode?: number) {
  const map = await loadMeta()
  const item = map.get(downloadKey(id, type, season, episode))
  return item?.status === 'done'
}

export async function getLocalPath(id: number, type: 'movie' | 'tv', season?: number, episode?: number) {
  const map = await loadMeta()
  const item = map.get(downloadKey(id, type, season, episode))
  if (item?.status === 'done' && item.localPath) return item.localPath
  return null
}

export async function deleteDownload(key: string) {
  const map = await loadMeta()
  const item = map.get(key)
  if (!item) return
  const dir = DOWNLOADS_DIR + key + '/'
  try { await FileSystem.deleteAsync(dir, { idempotent: true }) } catch {}
  map.delete(key)
  await saveMeta()
  notify()
}

// ── Motor de descarga ─────────────────────────────────────────────────────────

type SegmentInfo = { url: string; duration: number }

const MAX_CONCURRENT = 20  // segmentos en paralelo
const MAX_RETRIES    = 3   // reintentos por segmento

// Convierte ArrayBuffer a base64 para FileSystem.writeAsStringAsync
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x2000  // 8192 bytes — seguro en Hermes
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + CHUNK) as unknown as number[]))
  }
  return btoa(binary)
}

// AbortSignal.timeout() NO existe en el runtime de React Native (Hermes): usarlo
// lanzaba "AbortSignal.timeout is not a function" en el primer fetch, así que
// ninguna descarga llegaba a arrancar. Mismo patrón manual que lib/api.ts.
async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Map de descargas activas (para pausar/cancelar)
const _active = new Map<string, { cancelled: boolean }>()
// Descargas de archivo único en curso: hay que poder pausarlas de verdad, no
// solo marcar un flag — el resumable sigue escribiendo hasta que se le dice.
const _activeFile = new Map<string, FileSystem.DownloadResumable>()

// Nombre local del archivo, conservando la extensión real (mkv/mp4): el player
// decide por ella si va por VLCKit o por AVPlayer.
function fileNameFor(url: string): string {
  let ext = 'mp4'
  try {
    const m = decodeURIComponent(new URL(url).pathname).match(/\.(mkv|mp4|avi|m4v)$/i)
    if (m) ext = m[1].toLowerCase()
  } catch {}
  return `video.${ext}`
}

// Subtítulo en español para ver offline. Opcional: si falla, la descarga sigue
// siendo válida.
async function downloadSubtitle(
  dir: string, type: 'movie' | 'tv', id: number,
  season: number | undefined, episode: number | undefined,
  captionCount: number
): Promise<void> {
  if (captionCount === 0) return
  try {
    const url = `${API_URL}/stream/sub.vtt?type=${type}&id=${id}&season=${season ?? ''}&episode=${episode ?? ''}&i=0`
    await FileSystem.downloadAsync(url, dir + 'subs.vtt')
  } catch { /* subs opcionales */ }
}

export async function startDownload(opts: {
  id: number
  media_type: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path?: string | null
  season?: number
  episode?: number
  episodeTitle?: string
}) {
  const { id, media_type, season, episode } = opts
  const key = downloadKey(id, media_type, season, episode)
  const map = await loadMeta()

  // No re-descargar si ya está en progreso o completo
  const existing = map.get(key)
  if (existing?.status === 'downloading' || existing?.status === 'done') return

  // Registrar en pendiente
  const item: DownloadItem = {
    key,
    id,
    media_type,
    title: opts.title,
    poster_path: opts.poster_path,
    backdrop_path: opts.backdrop_path ?? null,
    season,
    episode,
    episodeTitle: opts.episodeTitle,
    status: 'pending',
    progress: 0,
    quality: '',
    totalSegments: 0,
    downloadedSegments: 0,
    addedAt: Date.now(),
  }
  map.set(key, item)
  await saveMeta()
  notify()

  // Ejecutar en segundo plano (no awaited)
  _runDownload(key, id, media_type, season, episode, item, map).catch(console.error)
}

async function _runDownload(
  key: string,
  id: number,
  type: 'movie' | 'tv',
  season: number | undefined,
  episode: number | undefined,
  item: DownloadItem,
  map: Map<string, DownloadItem>
) {
  const ctrl = { cancelled: false }
  _active.set(key, ctrl)
  let lastFileSave = 0

  const update = async (patch: Partial<DownloadItem>) => {
    Object.assign(item, patch)
    map.set(key, item)
    await saveMeta()
    notify()
  }

  try {
    // 1. Obtener lista de segmentos del API
    await update({ status: 'downloading' })
    const apiUrl = type === 'tv'
      ? `${API_URL}/download/tv/${id}/${season}/${episode}`
      : `${API_URL}/download/movie/${id}`

    const resp = await fetchWithTimeout(apiUrl, 90_000)
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`API ${resp.status}${body ? `: ${body.slice(0, 80)}` : ''}`)
    }
    type Caption = { language: string; url: string; type: string }
    const data:
      | { kind: 'file'; url: string; referer: string; quality: string; captions: Caption[] }
      | { kind: 'hls'; segments: SegmentInfo[]; referer: string; quality: string; captions: Caption[] }
      = await resp.json()

    if (ctrl.cancelled) return

    // 2. Crear directorio
    const dir = DOWNLOADS_DIR + key + '/'
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })

    // ── Fuente de archivo único (Real-Debrid) ──
    // Se baja con createDownloadResumable y NO con el camino de segmentos: ese
    // mete cada trozo en memoria como base64, lo cual con un MKV entero de
    // varios GB reventaría la app. El resumable escribe a disco en streaming y
    // además da progreso real por bytes.
    if (data.kind === 'file') {
      await update({ quality: data.quality, totalSegments: 1 })
      const dest = dir + fileNameFor(data.url)
      const resumable = FileSystem.createDownloadResumable(
        data.url,
        dest,
        { headers: data.referer ? { Referer: data.referer } : undefined },
        (p) => {
          if (!p.totalBytesExpectedToWrite || p.totalBytesExpectedToWrite < 0) return
          const ratio = p.totalBytesWritten / p.totalBytesExpectedToWrite
          // Throttle: el callback dispara muy seguido y cada update escribe
          // en AsyncStorage y notifica a la UI.
          const now = Date.now()
          if (now - lastFileSave < 700 && ratio < 1) return
          lastFileSave = now
          update({ progress: ratio, size: p.totalBytesWritten }).catch(() => {})
        }
      )
      _activeFile.set(key, resumable)
      try {
        const out = await resumable.downloadAsync()
        if (ctrl.cancelled) return
        if (!out?.uri) throw new Error('La descarga no devolvió archivo')
        await downloadSubtitle(dir, type, id, season, episode, data.captions.length)
        const info = await FileSystem.getInfoAsync(out.uri)
        await update({
          status: 'done', progress: 1, downloadedSegments: 1,
          localPath: out.uri, size: (info as any).size ?? 0,
        })
      } finally {
        _activeFile.delete(key)
      }
      return
    }

    // ── Fuente HLS: lista de segmentos ──
    // Alias con el tipo ya estrechado: TS no propaga el narrowing de `data`
    // dentro de las funciones anidadas de abajo (worker/downloadSegment).
    const hls = data
    await update({ totalSegments: hls.segments.length, quality: hls.quality })

    // 3. Descargar segmentos con concurrencia MAX_CONCURRENT y reintentos
    const referer = hls.referer
    let done = 0
    let lastSave = Date.now()

    async function downloadSegment(seg: SegmentInfo, idx: number): Promise<string> {
      if (ctrl.cancelled) throw new Error('cancelled')
      const filename = `seg-${String(idx).padStart(5, '0')}.ts`
      const localUri = dir + filename

      // Resume: saltar si ya existe con contenido
      const info = await FileSystem.getInfoAsync(localUri)
      if (info.exists && (info as any).size > 0) return localUri

      // Usar fetch + base64 write para control total de headers y manejo de errores
      let lastErr: Error = new Error('unknown')
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (ctrl.cancelled) throw new Error('cancelled')
        try {
          const resp = await fetchWithTimeout(seg.url, 20_000, {
            headers: referer ? { Referer: referer } : {},
          })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const buf = await resp.arrayBuffer()
          const b64 = bufToBase64(buf)
          await FileSystem.writeAsStringAsync(localUri, b64, {
            encoding: FileSystem.EncodingType.Base64,
          })
          return localUri
        } catch (e) {
          lastErr = e as Error
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 800))
        }
      }
      throw lastErr
    }

    const localUris: string[] = new Array(hls.segments.length).fill('')
    let segIdx = 0

    async function worker() {
      while (segIdx < hls.segments.length) {
        if (ctrl.cancelled) return
        const i = segIdx++
        localUris[i] = await downloadSegment(hls.segments[i], i)
        done++
        // Guardar progreso cada 20 segmentos o cada 3s (evita saturar AsyncStorage)
        const now = Date.now()
        if (done % 20 === 0 || done === hls.segments.length || now - lastSave > 3000) {
          lastSave = now
          await update({ downloadedSegments: done, progress: done / hls.segments.length })
        }
      }
    }

    await Promise.all(Array.from({ length: MAX_CONCURRENT }, () => worker()))
    if (ctrl.cancelled) return

    // 4. Escribir el m3u8 local
    const m3u8Lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...hls.segments.map(s => s.duration), 6))}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ]
    for (let i = 0; i < hls.segments.length; i++) {
      m3u8Lines.push(`#EXTINF:${hls.segments[i].duration.toFixed(3)},`)
      m3u8Lines.push(localUris[i])
    }
    m3u8Lines.push('#EXT-X-ENDLIST')
    const m3u8Path = dir + 'playlist.m3u8'
    await FileSystem.writeAsStringAsync(m3u8Path, m3u8Lines.join('\n'))

    // 5. Subtítulos (primer idioma disponible)
    await downloadSubtitle(dir, type, id, season, episode, hls.captions.length)

    // Estimar tamaño total
    const dirInfo = await FileSystem.getInfoAsync(dir)
    const size = (dirInfo as any).size ?? 0

    await update({
      status: 'done',
      progress: 1,
      downloadedSegments: hls.segments.length,
      localPath: m3u8Path,
      size,
    })

  } catch (e) {
    if (ctrl.cancelled) {
      await update({ status: 'paused' })
    } else {
      await update({ status: 'error', error: (e as Error).message?.slice(0, 120) })
    }
  } finally {
    _active.delete(key)
  }
}

export async function cancelDownload(key: string) {
  const ctrl = _active.get(key)
  if (ctrl) ctrl.cancelled = true

  // El resumable de archivo único no mira el flag: sigue escribiendo hasta que
  // se le pausa explícitamente. Sin esto la descarga continuaba en segundo
  // plano después de "cancelar" y volvía a crear el archivo ya borrado.
  const resumable = _activeFile.get(key)
  if (resumable) {
    await resumable.pauseAsync().catch(() => {})
    _activeFile.delete(key)
  }

  // Pequeño delay para que los workers de segmentos vean el flag
  await new Promise(r => setTimeout(r, 200))
  await deleteDownload(key)
}

// ── Smart Download ────────────────────────────────────────────────────────────

const SMART_KEY = 'bmo:smartDownload'

export async function isSmartDownloadEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(SMART_KEY)) !== 'false'
}

export async function setSmartDownload(enabled: boolean) {
  await AsyncStorage.setItem(SMART_KEY, String(enabled))
}

// Llama esto al terminar un episodio para pre-descargar el siguiente
export async function smartDownloadNext(opts: {
  id: number
  title: string
  poster_path: string | null
  backdrop_path?: string | null
  season: number
  currentEpisode: number
  seasonEpisodeNumbers: number[]   // lista de ep_numbers de la temporada actual
}) {
  if (!(await isSmartDownloadEnabled())) return
  const next = opts.currentEpisode + 1
  if (!opts.seasonEpisodeNumbers.includes(next)) return
  const alreadyDone = await isDownloaded(opts.id, 'tv', opts.season, next)
  if (alreadyDone) return
  startDownload({
    id: opts.id,
    media_type: 'tv',
    title: opts.title,
    poster_path: opts.poster_path,
    backdrop_path: opts.backdrop_path,
    season: opts.season,
    episode: next,
  })
}
