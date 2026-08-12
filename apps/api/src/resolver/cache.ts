import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Entry<T> = { value: T; expires: number }

/**
 * Almacén compartido entre instancias. Se inyecta (no se construye acá) para
 * poder testear el comportamiento del cache sin red.
 */
export type SharedStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
}

export type TTLCacheOptions = {
  // Persistencia local a JSON: sobrevive reinicios de un proceso. En Vercel
  // cada instancia tiene su propio /tmp, así que esto NO comparte nada.
  persistPath?: string
  // Almacén compartido entre instancias (ver sharedStoreFromEnv).
  shared?: SharedStore
  // Prefijo de las claves compartidas. Lleva versión: si cambia la forma de lo
  // que se guarda, subirla invalida todo lo viejo de una.
  namespace?: string
}

// Cuánto se espera al almacén compartido antes de seguir de largo y producir el
// valor igual. Un GET a Upstash en la misma región son ~10-20 ms; si tarda más
// que esto, algo anda mal y esperarlo sale más caro que recalcular.
const SHARED_READ_BUDGET_MS = 1_000

/**
 * Cache con TTL + dedup de promesas en vuelo, en tres niveles:
 *
 *   1. memoria del proceso — instantáneo, pero muere con la instancia
 *   2. almacén compartido (Redis REST) — sobrevive entre instancias
 *   3. disco (opcional) — sólo útil corriendo local
 *
 * El nivel 2 es el que hace que el pre-calentamiento sirva de algo. En Vercel
 * cada request puede caer en una instancia distinta: sin él, un prewarm que
 * aterrizaba en la instancia A no lo veía nunca el play que caía en la B, y el
 * usuario pagaba la resolución completa igual.
 */
export class TTLCache<T> {
  private store = new Map<string, Entry<T>>()
  private inflight = new Map<string, Promise<T>>()
  private persistPath?: string
  private shared?: SharedStore
  private namespace: string

  constructor(private ttlMs: number, opts: TTLCacheOptions = {}) {
    this.persistPath = opts.persistPath
    this.shared = opts.shared
    this.namespace = opts.namespace ?? 'bmo:v1'
    if (this.persistPath) this.loadFromDisk()
  }

  private loadFromDisk() {
    if (!this.persistPath) return
    try {
      const raw = readFileSync(this.persistPath, 'utf8')
      const obj = JSON.parse(raw) as Record<string, Entry<T>>
      const now = Date.now()
      for (const [key, entry] of Object.entries(obj)) {
        if (entry.expires > now) this.store.set(key, entry)
      }
    } catch {
      // Sin archivo aún o JSON inválido — empezar vacío
    }
  }

  private saveToDisk() {
    if (!this.persistPath) return
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true })
      const obj: Record<string, Entry<T>> = {}
      const now = Date.now()
      for (const [key, entry] of this.store) {
        if (entry.expires > now) obj[key] = entry
      }
      writeFileSync(this.persistPath, JSON.stringify(obj))
    } catch {
      // Disco de solo lectura (p.ej. Vercel fuera de /tmp) — ignorar
    }
  }

  private sharedKey(key: string): string {
    return `${this.namespace}:${key}`
  }

  // Lee del almacén compartido. Se guarda el `expires` ABSOLUTO dentro del
  // valor, no solo el TTL de Redis: un link de CDN caduca a una hora de reloj
  // concreta, y si al leerlo le renováramos la vida se serviría una URL muerta.
  private async readShared(key: string): Promise<Entry<T> | null> {
    if (!this.shared) return null
    try {
      const raw = await Promise.race([
        this.shared.get(this.sharedKey(key)),
        new Promise<null>((r) => setTimeout(() => r(null), SHARED_READ_BUDGET_MS)),
      ])
      if (!raw) return null
      const entry = JSON.parse(raw) as Entry<T>
      if (typeof entry?.expires !== 'number' || entry.expires <= Date.now()) return null
      return entry
    } catch {
      return null
    }
  }

  // Escritura sin await a propósito: la respuesta al usuario no tiene por qué
  // esperar a que el cache se pueble.
  private writeShared(key: string, entry: Entry<T>) {
    if (!this.shared) return
    const ttl = entry.expires - Date.now()
    if (ttl <= 0) return
    this.shared.set(this.sharedKey(key), JSON.stringify(entry), ttl).catch(() => {})
  }

  async resolve(key: string, producer: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.value
    }

    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = (async () => {
      // Nivel 2 antes de producir: puede haberlo resuelto otra instancia (por
      // ejemplo el prewarm disparado al tocar el póster).
      const fromShared = await this.readShared(key)
      if (fromShared) {
        this.store.set(key, fromShared)
        return fromShared.value
      }

      const value = await producer()
      // No persistimos fallos (null/undefined): un error temporal no debe
      // quedar cacheado ni para esta instancia ni para las demás.
      if (value != null) {
        const entry: Entry<T> = { value, expires: Date.now() + this.ttlMs }
        this.store.set(key, entry)
        this.writeShared(key, entry)
        this.saveToDisk()
      }
      return value
    })().finally(() => {
      this.inflight.delete(key)
    })

    this.inflight.set(key, promise)
    return promise
  }

  invalidate(key: string) {
    this.store.delete(key)
    this.saveToDisk()
  }
}

// ── Almacén compartido sobre Redis REST ─────────────────────────────────────
// Vale tanto para Upstash directo como para Vercel KV (que es Upstash por
// debajo y expone las mismas dos variables con otro nombre). Se habla por HTTP
// con el formato de comando en el body, que es el único que aguanta valores
// grandes sin meterlos en la URL.

const COMMAND_TIMEOUT_MS = 2_000

export function redisRestStore(url: string, token: string): SharedStore {
  const command = async (args: (string | number)[]): Promise<unknown> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`redis ${res.status}`)
    const body = await res.json() as { result?: unknown; error?: string }
    if (body.error) throw new Error(body.error)
    return body.result
  }

  return {
    async get(key) {
      const result = await command(['GET', key])
      return typeof result === 'string' ? result : null
    },
    async set(key, value, ttlMs) {
      // PX = expiración en milisegundos. Es sólo la red de contención: la
      // verdad sobre la caducidad viaja dentro del propio valor.
      await command(['SET', key, value, 'PX', Math.max(1, Math.round(ttlMs))])
    },
  }
}

/**
 * Arma el almacén compartido si el entorno lo trae configurado. Sin variables
 * devuelve undefined y todo sigue funcionando exactamente como antes (memoria +
 * disco), que es lo que pasa corriendo local.
 *
 * Se acepta el naming de los dos proveedores porque Vercel KV ES Upstash por
 * debajo y solo cambia el nombre de las variables:
 *
 *   Upstash directo (console.upstash.com → Redis → REST API):
 *     UPSTASH_REDIS_REST_URL=https://<algo>.upstash.io
 *     UPSTASH_REDIS_REST_TOKEN=<token>
 *
 *   Vercel KV / Marketplace (las inyecta solo al conectar el store al proyecto):
 *     KV_REST_API_URL / KV_REST_API_TOKEN
 *
 * Elegir la región del store PEGADA a la de las funciones: el beneficio es
 * ahorrarse ~3 s de resolución, y un round-trip transatlántico se come parte de
 * eso. Sin variables no hay error ni warning, solo se pierde el compartir.
 */
export function sharedStoreFromEnv(env: Record<string, string | undefined> = process.env): SharedStore | undefined {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN
  if (!url || !token) return undefined
  return redisRestStore(url, token)
}
