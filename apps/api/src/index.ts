import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'

const app = new Elysia()
  .use(cors())
  .get('/health', () => ({ status: 'ok', service: 'bmo-api' }))
  .listen(3000)

console.log(`BMO API → http://localhost:${app.server?.port}`)
