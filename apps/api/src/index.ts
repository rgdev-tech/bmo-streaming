import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { tmdbRoutes } from './tmdb/tmdb.routes'
import { resolverRoutes } from './resolver/resolver.routes'
import { streamRoutes } from './resolver/stream.routes'
import { downloadRoutes } from './resolver/download.routes'
import { rateLimit } from './rate-limit'

export const app = new Elysia()
  .use(cors())
  .use(rateLimit({ windowMs: 60_000, max: 120 }))
  .get('/health', () => ({ status: 'ok', service: 'bmo-api' }))
  .use(tmdbRoutes)
  .use(resolverRoutes)
  .use(streamRoutes)
  .use(downloadRoutes)

// En local arranca el servidor; en Vercel se exporta el fetch handler
if (!process.env.VERCEL) {
  app.listen({ port: 3000, hostname: '0.0.0.0' })
  console.log(`BMO API → http://localhost:3000`)
}

// Pre-calienta el caché en cuanto el servidor está listo
// (silencioso — los errores no deben crashear el arranque)
async function warmCache() {
  const base = process.env.VERCEL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'
  const endpoints = ['/tmdb/home', '/tmdb/movies', '/tmdb/series', '/tmdb/collections', '/tmdb/categories']
  await Promise.allSettled(endpoints.map((p) => fetch(`${base}${p}`)))
  console.log('BMO API → caché TMDB pre-calentado')
}

setTimeout(warmCache, 500)

export default app.fetch
