import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MediaItem } from './tmdb'
import { supabase, supabaseConfigured } from './supabase'
import { getActiveProfileId } from './auth'

// Biblioteca local-first.
//
// La API pública de este módulo NO cambió al conectar Supabase: los 8 archivos
// que la consumen (player, title, library, Hero, ContinueRow/Card,
// SeasonEpisodes, home) siguen llamando exactamente lo mismo. Todo el trabajo
// de sincronización vive acá adentro.
//
// Reglas:
//  - LEER es siempre local (AsyncStorage). Cero spinners, funciona sin señal.
//  - ESCRIBIR es local primero (optimista) y se empuja a Supabase en segundo
//    plano. Si la red falla, la operación queda en un outbox y se reintenta.
//  - Al activar un perfil se hace pull y el remoto pasa a ser la verdad.
//
// Las claves locales van namespaceadas por perfil: dos perfiles en el mismo
// teléfono no pueden compartir "seguir viendo". Sin sesión se usan las claves
// legacy, así la app sigue funcionando igual que antes de Supabase.

const LEGACY_LIST = 'bmo:mylist'
const LEGACY_PROGRESS = 'bmo:progress'
const LEGACY_WATCHED = 'bmo:watched'
const OUTBOX_KEY = 'bmo:outbox'
const MIGRATED_PREFIX = 'bmo:migrated:'

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

// ── Almacenamiento local ────────────────────────────────────────────────────

// Devuelve null cuando hay cuentas configuradas pero el perfil todavía no se
// resolvió (la ventana de arranque en la que AuthProvider aún consulta la
// sesión).
//
// NO se puede caer a la clave legacy en ese caso: esa clave guarda la foto de
// antes de las cuentas y ya no se actualiza —los borrados escriben en la clave
// del perfil—, así que leerla hacía reaparecer en cada arranque todo lo que el
// usuario había eliminado de Mi Lista y de Seguir viendo.
function keyFor(base: string): string | null {
  const pid = getActiveProfileId()
  if (pid) return `${base}:${pid}`
  return supabaseConfigured ? null : base
}

async function read<T>(base: string): Promise<T[]> {
  const key = keyFor(base)
  if (!key) return []
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

async function write<T>(base: string, value: T[]) {
  const key = keyFor(base)
  // Sin perfil resuelto no se escribe: iría a parar a la clave equivocada y se
  // perdería (o contaminaría a otro perfil) en cuanto el perfil llegue.
  if (!key) return
  await AsyncStorage.setItem(key, JSON.stringify(value))
}

// ── Outbox: escrituras que no llegaron al servidor ──────────────────────────
// Sin esto, marcar un episodio como visto en el subte se perdería para siempre.

type Op =
  | { t: 'list.add'; item: LibraryItem }
  | { t: 'list.del'; id: number; media_type: 'movie' | 'tv' }
  | { t: 'progress.set'; p: Progress }
  | { t: 'progress.del'; id: number; media_type: 'movie' | 'tv' }
  | { t: 'watched.set'; tvId: number; season: number; episode: number; watched: boolean }

type QueuedOp = { profileId: string; op: Op }

const remoteOn = () => supabaseConfigured && !!getActiveProfileId()

async function enqueue(op: Op) {
  const pid = getActiveProfileId()
  if (!pid) return
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY)
    const queue: QueuedOp[] = raw ? JSON.parse(raw) : []
    queue.push({ profileId: pid, op })
    // Tope defensivo: sin límite, un dispositivo mucho tiempo sin red podría
    // llenar el almacenamiento con operaciones ya irrelevantes.
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(queue.slice(-500)))
  } catch {}
}

// Aplica una operación contra Supabase. Devuelve false si hay que reintentar.
async function applyRemote(profileId: string, op: Op): Promise<boolean> {
  try {
    switch (op.t) {
      case 'list.add': {
        const { error } = await supabase.from('list_items').upsert({
          profile_id: profileId,
          tmdb_id: op.item.id,
          media_type: op.item.media_type,
          title: op.item.title,
          poster_path: op.item.poster_path,
          backdrop_path: op.item.backdrop_path,
        })
        return !error
      }
      case 'list.del': {
        const { error } = await supabase.from('list_items').delete()
          .match({ profile_id: profileId, tmdb_id: op.id, media_type: op.media_type })
        return !error
      }
      case 'progress.set': {
        const { error } = await supabase.from('progress').upsert({
          profile_id: profileId,
          tmdb_id: op.p.id,
          media_type: op.p.media_type,
          // 0 para películas: son parte de la PK y no pueden ser NULL.
          season: op.p.season ?? 0,
          episode: op.p.episode ?? 0,
          title: op.p.title,
          poster_path: op.p.poster_path,
          backdrop_path: op.p.backdrop_path,
          position_s: Math.round(op.p.position),
          duration_s: Math.round(op.p.duration),
        })
        return !error
      }
      case 'progress.del': {
        const { error } = await supabase.from('progress').delete()
          .match({ profile_id: profileId, tmdb_id: op.id, media_type: op.media_type })
        return !error
      }
      case 'watched.set': {
        if (op.watched) {
          const { error } = await supabase.from('watched_episodes').upsert({
            profile_id: profileId, tmdb_id: op.tvId, season: op.season, episode: op.episode,
          })
          return !error
        }
        const { error } = await supabase.from('watched_episodes').delete()
          .match({ profile_id: profileId, tmdb_id: op.tvId, season: op.season, episode: op.episode })
        return !error
      }
    }
  } catch {
    return false
  }
}

// Escritura optimista: no se espera al servidor. Si falla, va al outbox.
function push(op: Op) {
  if (!remoteOn()) return
  const pid = getActiveProfileId()!
  applyRemote(pid, op)
    .then((ok) => { if (!ok) enqueue(op) })
    .catch(() => enqueue(op))
}

async function flushOutbox() {
  if (!supabaseConfigured) return
  let queue: QueuedOp[] = []
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY)
    queue = raw ? JSON.parse(raw) : []
  } catch { return }
  if (!queue.length) return

  const pending: QueuedOp[] = []
  for (const q of queue) {
    const ok = await applyRemote(q.profileId, q.op)
    if (!ok) pending.push(q)
  }
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(pending))
}

// ── Mi Lista ────────────────────────────────────────────────────────────────

export async function getMyList(): Promise<LibraryItem[]> {
  return read<LibraryItem>(LEGACY_LIST)
}

export async function isInMyList(id: number, type: 'movie' | 'tv') {
  const list = await getMyList()
  return list.some((i) => i.id === id && i.media_type === type)
}

// Eliminación EXPLÍCITA, sin alternar. La usa el botón de quitar de Mi Lista.
//
// No se puede usar toggleMyList ahí: si por cualquier desajuste el item no
// aparece en la lista local, el toggle lo interpreta como "no estaba" y lo
// AGREGA — local y remotamente. Como la pantalla además lo oculta de forma
// optimista, el usuario veía que se quitaba y reaparecía al recargar.
// Espeja a removeProgress, que sí borra siempre y por eso Seguir viendo
// nunca tuvo este problema.
export async function removeFromMyList(id: number, type: 'movie' | 'tv') {
  const list = await getMyList()
  await write(LEGACY_LIST, list.filter((i) => !(i.id === id && i.media_type === type)))
  push({ t: 'list.del', id, media_type: type })
}

export async function toggleMyList(item: LibraryItem): Promise<boolean> {
  const list = await getMyList()
  const exists = list.some((i) => i.id === item.id && i.media_type === item.media_type)
  const next = exists
    ? list.filter((i) => !(i.id === item.id && i.media_type === item.media_type))
    : [item, ...list]
  await write(LEGACY_LIST, next)
  push(exists
    ? { t: 'list.del', id: item.id, media_type: item.media_type }
    : { t: 'list.add', item })
  return !exists // true = añadido
}

// ── Seguir viendo ───────────────────────────────────────────────────────────

// Una fila por TÍTULO (el episodio tocado más recientemente), igual que la
// vista continue_watching del servidor. El almacenamiento es por episodio.
export async function getContinueWatching(): Promise<Progress[]> {
  const all = await read<Progress>(LEGACY_PROGRESS)
  const byTitle = new Map<string, Progress>()
  for (const p of all.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const k = `${p.media_type}:${p.id}`
    if (!byTitle.has(k)) byTitle.set(k, p)
  }
  return [...byTitle.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveProgress(p: Omit<Progress, 'updatedAt'>) {
  const all = await read<Progress>(LEGACY_PROGRESS)
  // Se reemplaza la fila de ESTE episodio, no la del título entero: dejar
  // S1E5 a la mitad y abrir S1E3 ya no borra el progreso de E5.
  const filtered = all.filter(
    (i) => !(i.id === p.id && i.media_type === p.media_type
      && (i.season ?? 0) === (p.season ?? 0) && (i.episode ?? 0) === (p.episode ?? 0))
  )
  const ratio = p.duration > 0 ? p.position / p.duration : 0

  if (ratio > 0.92 || p.position < 10) {
    if (ratio > 0.92 && p.media_type === 'tv' && p.season != null && p.episode != null) {
      await markEpisodeWatched(p.id, p.season, p.episode)
    }
    await write(LEGACY_PROGRESS, filtered)
    push({ t: 'progress.del', id: p.id, media_type: p.media_type })
    return
  }

  const row: Progress = { ...p, updatedAt: Date.now() }
  await write(LEGACY_PROGRESS, [row, ...filtered])
  push({ t: 'progress.set', p: row })
}

// Registra un episodio como "próximo a ver" en Seguir viendo (position 0).
// Se usa al terminar un episodio para encolar el siguiente.
export async function setUpNext(
  item: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
) {
  const all = await read<Progress>(LEGACY_PROGRESS)
  const filtered = all.filter(
    (i) => !(i.id === item.id && i.media_type === item.media_type)
  )
  const row: Progress = { ...item, position: 0, duration: 0, updatedAt: Date.now() }
  await write(LEGACY_PROGRESS, [row, ...filtered])
  push({ t: 'progress.set', p: row })
}

export async function getProgress(
  id: number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<number> {
  const all = await read<Progress>(LEGACY_PROGRESS)
  const found = all.find(
    (i) =>
      i.id === id &&
      i.media_type === type &&
      (i.season ?? 0) === (season ?? 0) &&
      (i.episode ?? 0) === (episode ?? 0)
  )
  return found?.position ?? 0
}

export async function removeProgress(id: number, type: 'movie' | 'tv') {
  const all = await read<Progress>(LEGACY_PROGRESS)
  await write(
    LEGACY_PROGRESS,
    all.filter((i) => !(i.id === id && i.media_type === type))
  )
  push({ t: 'progress.del', id, media_type: type })
}

// ── Episodios vistos ────────────────────────────────────────────────────────
// Cada entrada es una clave "tvId:season:episode"

function epKey(tvId: number | string, season: number, episode: number) {
  return `${tvId}:${season}:${episode}`
}

export async function getWatchedEpisodes(
  tvId: number | string
): Promise<Set<string>> {
  const all = await read<string>(LEGACY_WATCHED)
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
  const all = await read<string>(LEGACY_WATCHED)
  return all.includes(epKey(tvId, season, episode))
}

export async function markEpisodeWatched(
  tvId: number | string,
  season: number,
  episode: number,
  watched = true
) {
  const all = await read<string>(LEGACY_WATCHED)
  const key = epKey(tvId, season, episode)
  const next = watched
    ? all.includes(key) ? all : [key, ...all]
    : all.filter((k) => k !== key)
  await write(LEGACY_WATCHED, next)
  push({ t: 'watched.set', tvId: Number(tvId), season, episode, watched })
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

export async function setSeasonWatched(
  tvId: number | string,
  season: number,
  episodes: number[],
  watched: boolean
) {
  const all = await read<string>(LEGACY_WATCHED)
  const keys = episodes.map((e) => epKey(tvId, season, e))
  let next: string[]
  if (watched) {
    next = [...new Set([...all, ...keys])]
  } else {
    const remove = new Set(keys)
    next = all.filter((k) => !remove.has(k))
  }
  await write(LEGACY_WATCHED, next)
  for (const e of episodes) {
    push({ t: 'watched.set', tvId: Number(tvId), season, episode: e, watched })
  }
}

// ── Sincronización ──────────────────────────────────────────────────────────

// Sube lo que ya había en el teléfono ANTES de existir las cuentas. Corre una
// sola vez por perfil: sin esto, al entrar por primera vez el usuario vería su
// biblioteca vacía y pensaría que perdió todo.
async function migrateLegacy(profileId: string) {
  const flag = `${MIGRATED_PREFIX}${profileId}`
  if (await AsyncStorage.getItem(flag)) {
    // Ya migrado en un arranque anterior: igual se limpian las claves legacy,
    // porque los dispositivos que migraron ANTES de este arreglo las
    // conservan. Es idempotente.
    await AsyncStorage.multiRemove([LEGACY_LIST, LEGACY_PROGRESS, LEGACY_WATCHED]).catch(() => {})
    return
  }

  const [rawList, rawProgress, rawWatched] = await Promise.all([
    AsyncStorage.getItem(LEGACY_LIST),
    AsyncStorage.getItem(LEGACY_PROGRESS),
    AsyncStorage.getItem(LEGACY_WATCHED),
  ])
  try {
    const list: LibraryItem[] = rawList ? JSON.parse(rawList) : []
    const progress: Progress[] = rawProgress ? JSON.parse(rawProgress) : []
    const watched: string[] = rawWatched ? JSON.parse(rawWatched) : []

    for (const item of list) await applyRemote(profileId, { t: 'list.add', item })
    for (const p of progress) await applyRemote(profileId, { t: 'progress.set', p })
    for (const k of watched) {
      const [tvId, season, episode] = k.split(':').map(Number)
      if (Number.isFinite(tvId)) {
        await applyRemote(profileId, { t: 'watched.set', tvId, season, episode, watched: true })
      }
    }
    if (list.length || progress.length || watched.length) {
      console.log(`[library] migrados al perfil: ${list.length} lista, ${progress.length} progreso, ${watched.length} vistos`)
    }
    // Se borran una vez absorbidas. Si quedaran, seguirían siendo una copia
    // congelada del estado previo a las cuentas que nadie actualiza — y
    // cualquier lectura que las alcanzara resucitaría lo ya borrado.
    await AsyncStorage.multiRemove([LEGACY_LIST, LEGACY_PROGRESS, LEGACY_WATCHED])
  } catch {}
  await AsyncStorage.setItem(flag, '1')
}

// Borra el caché local de un perfil eliminado. La base ya lo limpia en
// cascada, pero las claves namespaceadas de AsyncStorage viven solo en el
// dispositivo: sin esto quedarían huérfanas ocupando espacio para siempre.
export async function clearProfileCache(profileId: string) {
  await AsyncStorage.multiRemove([
    `${LEGACY_LIST}:${profileId}`,
    `${LEGACY_PROGRESS}:${profileId}`,
    `${LEGACY_WATCHED}:${profileId}`,
    `${MIGRATED_PREFIX}${profileId}`,
  ]).catch(() => {})

  // Y las operaciones pendientes de ese perfil: reintentarlas fallaría siempre
  // (la fila ya no existe) y bloquearían el outbox del resto.
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY)
    if (!raw) return
    const queue: QueuedOp[] = JSON.parse(raw)
    const kept = queue.filter((q) => q.profileId !== profileId)
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(kept))
  } catch {}
}

// Trae el estado del servidor y reemplaza el caché local del perfil activo.
// Se llama al activar un perfil (ver AuthProvider). El remoto gana: es la única
// forma de que borrar algo en otro dispositivo no reviva acá.
export async function syncLibrary(): Promise<void> {
  const profileId = getActiveProfileId()
  if (!supabaseConfigured || !profileId) return

  await migrateLegacy(profileId)
  await flushOutbox()

  try {
    const [list, progress, watched] = await Promise.all([
      supabase.from('list_items').select('*').order('added_at', { ascending: false }),
      supabase.from('progress').select('*').order('updated_at', { ascending: false }),
      supabase.from('watched_episodes').select('tmdb_id, season, episode'),
    ])

    if (!list.error && list.data) {
      await write<LibraryItem>(LEGACY_LIST, list.data.map((r: any) => ({
        id: r.tmdb_id,
        media_type: r.media_type,
        title: r.title,
        poster_path: r.poster_path,
        backdrop_path: r.backdrop_path,
      })))
    }

    if (!progress.error && progress.data) {
      await write<Progress>(LEGACY_PROGRESS, progress.data.map((r: any) => ({
        id: r.tmdb_id,
        media_type: r.media_type,
        title: r.title,
        poster_path: r.poster_path,
        backdrop_path: r.backdrop_path,
        // 0 en el servidor significa "no aplica" (película) — se vuelve a
        // undefined para que el resto del código lo trate como antes.
        season: r.season || undefined,
        episode: r.episode || undefined,
        position: r.position_s,
        duration: r.duration_s,
        updatedAt: new Date(r.updated_at).getTime(),
      })))
    }

    if (!watched.error && watched.data) {
      await write<string>(LEGACY_WATCHED,
        watched.data.map((r: any) => epKey(r.tmdb_id, r.season, r.episode)))
    }
  } catch (e) {
    // Sin red se sigue con el caché local: la app no debe romperse por esto.
    console.warn('[library] sync falló, se usa el caché local:', (e as Error).message)
  }
}
