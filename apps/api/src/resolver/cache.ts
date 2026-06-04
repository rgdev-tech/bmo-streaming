import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Entry<T> = { value: T; expires: number }

/**
 * Cache con TTL + dedup de promesas en vuelo.
 * Opcionalmente persiste a disco (JSON) para sobrevivir reinicios del API.
 */
export class TTLCache<T> {
  private store = new Map<string, Entry<T>>()
  private inflight = new Map<string, Promise<T>>()
  private persistPath?: string

  constructor(private ttlMs: number, persistPath?: string) {
    this.persistPath = persistPath
    if (persistPath) this.loadFromDisk()
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

  async resolve(key: string, producer: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.value
    }

    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = producer()
      .then((value) => {
        // No persistimos fallos (null/undefined): un error temporal no debe quedar cacheado
        if (value != null) {
          this.store.set(key, { value, expires: Date.now() + this.ttlMs })
          this.saveToDisk()
        }
        return value
      })
      .finally(() => {
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
