import { Elysia } from 'elysia'

/**
 * Rate limiter simple en memoria (ventana fija por IP).
 * Suficiente para proteger el API de abuso básico sin dependencias externas.
 */
export function rateLimit(opts: { windowMs: number; max: number } = { windowMs: 60_000, max: 120 }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  // Limpieza periódica de entradas viejas
  setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of hits) {
      if (entry.resetAt < now) hits.delete(ip)
    }
  }, opts.windowMs).unref?.()

  return new Elysia({ name: 'rate-limit' }).onRequest(({ request, set }) => {
    // No limitamos el streaming del video (master/sub piden muchos segmentos)
    const url = new URL(request.url)
    if (url.pathname.startsWith('/stream/')) return

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'local'

    const now = Date.now()
    const entry = hits.get(ip)

    if (!entry || entry.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + opts.windowMs })
      return
    }

    entry.count++
    if (entry.count > opts.max) {
      set.status = 429
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      set.headers['retry-after'] = String(retryAfter)
      return { error: 'Demasiadas peticiones. Intenta más tarde.' }
    }
  })
}
