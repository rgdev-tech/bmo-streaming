import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { tmdbRoutes } from './tmdb/tmdb.routes'
import { resolverRoutes } from './resolver/resolver.routes'

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok', service: 'bmo-api' }))
  .use(tmdbRoutes)
  .use(resolverRoutes)
  .listen({ port: 3000, hostname: '0.0.0.0' })

console.log(`BMO API → http://localhost:${app.server?.port}`)
