type Entry<T> = { value: T; expires: number }

/**
 * Cache en memoria con TTL + dedup de promesas en vuelo.
 * Evita re-resolver el mismo título y colapsa peticiones simultáneas.
 */
export class TTLCache<T> {
  private store = new Map<string, Entry<T>>()
  private inflight = new Map<string, Promise<T>>()

  constructor(private ttlMs: number) {}

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
  }
}
