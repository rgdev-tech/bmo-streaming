import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MediaItem } from './tmdb'

const LIST_KEY = 'bmo:mylist'
const PROGRESS_KEY = 'bmo:progress'
const WATCHED_KEY = 'bmo:watched'

export type LibraryItem = {
  id: number
  media_type: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path: string | null
}

export type Progress = LibraryItem & {
  season?: number
  episode?: number
  position: number // segundos vistos
  duration: number // segundos totales
  updatedAt: number
}

function mediaType(item: MediaItem): 'movie' | 'tv' {
  if (item.media_type === 'tv' || item.media_type === 'movie') return item.media_type
  return item.name && !item.title ? 'tv' : 'movie'
}

export function toLibraryItem(item: MediaItem): LibraryItem {
  return {
    id: item.id,
    media_type: mediaType(item),
    title: item.title ?? item.name ?? 'Sin título',
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
  }
}

async function read<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

async function write<T>(key: string, value: T[]) {
  await AsyncStorage.setItem(key, JSON.stringify(value))
}

// ---- Mi Lista ----

export async function getMyList(): Promise<LibraryItem[]> {
  return read<LibraryItem>(LIST_KEY)
}

export async function isInMyList(id: number, type: 'movie' | 'tv') {
  const list = await getMyList()
  return list.some((i) => i.id === id && i.media_type === type)
}

export async function toggleMyList(item: LibraryItem): Promise<boolean> {
  const list = await getMyList()
  const exists = list.some((i) => i.id === item.id && i.media_type === item.media_type)
  const next = exists
    ? list.filter((i) => !(i.id === item.id && i.media_type === item.media_type))
    : [item, ...list]
  await write(LIST_KEY, next)
  return !exists // true = añadido
}

// ---- Seguir viendo ----

export async function getContinueWatching(): Promise<Progress[]> {
  const all = await read<Progress>(PROGRESS_KEY)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveProgress(p: Omit<Progress, 'updatedAt'>) {
  // Si está casi terminado (>92%), lo quitamos de seguir viendo
  const all = await read<Progress>(PROGRESS_KEY)
  const filtered = all.filter(
    (i) => !(i.id === p.id && i.media_type === p.media_type)
  )
  const ratio = p.duration > 0 ? p.position / p.duration : 0
  if (ratio > 0.92 || p.position < 10) {
    // Si terminó un episodio de serie, lo marcamos como visto
    if (ratio > 0.92 && p.media_type === 'tv' && p.season != null && p.episode != null) {
      await markEpisodeWatched(p.id, p.season, p.episode)
    }
    await write(PROGRESS_KEY, filtered)
    return
  }
  await write(PROGRESS_KEY, [{ ...p, updatedAt: Date.now() }, ...filtered])
}

// Registra un episodio como "próximo a ver" en Seguir viendo (position 0).
// Se usa al terminar un episodio para encolar el siguiente.
export async function setUpNext(
  item: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
) {
  const all = await read<Progress>(PROGRESS_KEY)
  const filtered = all.filter(
    (i) => !(i.id === item.id && i.media_type === item.media_type)
  )
  await write(PROGRESS_KEY, [
    { ...item, position: 0, duration: 0, updatedAt: Date.now() },
    ...filtered,
  ])
}

export async function getProgress(
  id: number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<number> {
  const all = await read<Progress>(PROGRESS_KEY)
  const found = all.find(
    (i) =>
      i.id === id &&
      i.media_type === type &&
      i.season === season &&
      i.episode === episode
  )
  return found?.position ?? 0
}

export async function removeProgress(id: number, type: 'movie' | 'tv') {
  const all = await read<Progress>(PROGRESS_KEY)
  await write(
    PROGRESS_KEY,
    all.filter((i) => !(i.id === id && i.media_type === type))
  )
}

// ---- Episodios vistos ----
// Cada entrada es una clave "tvId:season:episode"

function epKey(tvId: number | string, season: number, episode: number) {
  return `${tvId}:${season}:${episode}`
}

// Devuelve un Set de claves "season:episode" vistas de una serie
export async function getWatchedEpisodes(
  tvId: number | string
): Promise<Set<string>> {
  const all = await read<string>(WATCHED_KEY)
  const prefix = `${tvId}:`
  const set = new Set<string>()
  for (const k of all) {
    if (k.startsWith(prefix)) set.add(k.slice(prefix.length))
  }
  return set
}

export async function isEpisodeWatched(
  tvId: number | string,
  season: number,
  episode: number
): Promise<boolean> {
  const all = await read<string>(WATCHED_KEY)
  return all.includes(epKey(tvId, season, episode))
}

export async function markEpisodeWatched(
  tvId: number | string,
  season: number,
  episode: number,
  watched = true
) {
  const all = await read<string>(WATCHED_KEY)
  const key = epKey(tvId, season, episode)
  const next = watched
    ? all.includes(key) ? all : [key, ...all]
    : all.filter((k) => k !== key)
  await write(WATCHED_KEY, next)
}

export async function toggleEpisodeWatched(
  tvId: number | string,
  season: number,
  episode: number
): Promise<boolean> {
  const watched = await isEpisodeWatched(tvId, season, episode)
  await markEpisodeWatched(tvId, season, episode, !watched)
  return !watched
}

// Marca/desmarca varios episodios de una temporada de una sola vez
export async function setSeasonWatched(
  tvId: number | string,
  season: number,
  episodes: number[],
  watched: boolean
) {
  const all = await read<string>(WATCHED_KEY)
  const keys = episodes.map((e) => epKey(tvId, season, e))
  let next: string[]
  if (watched) {
    const set = new Set([...all, ...keys])
    next = [...set]
  } else {
    const remove = new Set(keys)
    next = all.filter((k) => !remove.has(k))
  }
  await write(WATCHED_KEY, next)
}
