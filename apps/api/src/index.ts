import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { tmdbRoutes } from './tmdb/tmdb.routes'
import { resolverRoutes } from './resolver/resolver.routes'
import { streamRoutes } from './resolver/stream.routes'

export const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok', service: 'bmo-api' }))
  .use(tmdbRoutes)
  .use(resolverRoutes)
  .use(streamRoutes)

// En local arranca el servidor; en Vercel se exporta el fetch handler
if (!process.env.VERCEL) {
  app.listen({ port: 3000, hostname: '0.0.0.0' })
  console.log(`BMO API → http://localhost:3000`)
}

export default app.fetch
