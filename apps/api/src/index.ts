import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { tmdbRoutes } from './tmdb/tmdb.routes'
import { resolverRoutes } from './resolver/resolver.routes'
import { streamRoutes } from './resolver/stream.routes'
import { getBrowser } from './resolver/browser'

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok', service: 'bmo-api' }))
  .use(tmdbRoutes)
  .use(resolverRoutes)
  .use(streamRoutes)
  .listen({ port: 3000, hostname: '0.0.0.0' })

console.log(`BMO API → http://localhost:${app.server?.port}`)

// Pre-calentamos el navegador en segundo plano para que la primera
// resolución no pague el coste de lanzar Chromium.
getBrowser()
  .then(() => console.log('Chromium pre-calentado ✓'))
  .catch((e) => console.warn('No se pudo pre-calentar Chromium:', e))
