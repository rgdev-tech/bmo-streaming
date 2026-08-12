import { describe, expect, test } from 'bun:test'
import { TTLCache, sharedStoreFromEnv, redisRestStore, type SharedStore } from './cache'

// Store falso en memoria: mismo contrato que Redis REST, sin red.
function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed))
  const calls = { get: [] as string[], set: [] as { key: string; ttlMs: number }[] }
  const store: SharedStore = {
    async get(key) { calls.get.push(key); return data.get(key) ?? null },
    async set(key, value, ttlMs) { calls.set.push({ key, ttlMs }); data.set(key, value) },
  }
  return { store, data, calls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('TTLCache — memoria y dedup (comportamiento previo)', () => {
  test('un hit en memoria no vuelve a producir', async () => {
    const cache = new TTLCache<string>(60_000)
    let calls = 0
    const produce = async () => { calls++; return 'v' }

    expect(await cache.resolve('k', produce)).toBe('v')
    expect(await cache.resolve('k', produce)).toBe('v')
    expect(calls).toBe(1)
  })

  test('dos llamadas concurrentes comparten la misma producción', async () => {
    const cache = new TTLCache<string>(60_000)
    let calls = 0
    const produce = async () => { calls++; await tick(); return 'v' }

    const [a, b] = await Promise.all([cache.resolve('k', produce), cache.resolve('k', produce)])
    expect(a).toBe('v')
    expect(b).toBe('v')
    expect(calls).toBe(1)
  })

  test('null no se cachea: un fallo temporal no queda pegado', async () => {
    const cache = new TTLCache<string | null>(60_000)
    let calls = 0
    const produce = async () => { calls++; return calls === 1 ? null : 'v' }

    expect(await cache.resolve('k', produce)).toBeNull()
    expect(await cache.resolve('k', produce)).toBe('v')
    expect(calls).toBe(2)
  })
})

describe('TTLCache — almacén compartido', () => {
  test('un valor puesto por OTRA instancia evita producir', async () => {
    // Este es el caso que arregla el prewarm: la instancia A resolvió, la B
    // atiende el play y no tiene nada en su memoria local.
    const entry = JSON.stringify({ value: 'de-otra-instancia', expires: Date.now() + 60_000 })
    const { store, calls } = fakeStore({ 'bmo:test:k': entry })
    const cache = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:test' })

    let produced = 0
    const value = await cache.resolve('k', async () => { produced++; return 'recalculado' })

    expect(value).toBe('de-otra-instancia')
    expect(produced).toBe(0)
    expect(calls.get).toEqual(['bmo:test:k'])
  })

  test('lo producido se publica para las demás instancias', async () => {
    const { store, data, calls } = fakeStore()
    const cache = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:test' })

    await cache.resolve('k', async () => 'v')
    await tick()   // la escritura es fire-and-forget

    expect(calls.set).toHaveLength(1)
    expect(calls.set[0].key).toBe('bmo:test:k')
    expect(calls.set[0].ttlMs).toBeGreaterThan(0)
    expect(JSON.parse(data.get('bmo:test:k')!).value).toBe('v')
  })

  test('una entrada compartida VENCIDA se ignora y se vuelve a producir', async () => {
    // La caducidad viaja dentro del valor, no depende del TTL de Redis: un link
    // de CDN vence a una hora concreta y servirlo "renovado" sería servir basura.
    const vencida = JSON.stringify({ value: 'viejo', expires: Date.now() - 1 })
    const { store } = fakeStore({ 'bmo:test:k': vencida })
    const cache = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:test' })

    expect(await cache.resolve('k', async () => 'fresco')).toBe('fresco')
  })

  test('leer del compartido no renueva la vida del valor', async () => {
    const expires = Date.now() + 5_000
    const { store, data } = fakeStore({ 'bmo:test:k': JSON.stringify({ value: 'v', expires }) })
    const cache = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:test' })

    await cache.resolve('k', async () => 'no-deberia-producir')
    await tick()
    // No se reescribe con un expires nuevo: sigue el original.
    expect(JSON.parse(data.get('bmo:test:k')!).expires).toBe(expires)
  })

  test('si el almacén falla, se produce igual (no rompe la reproducción)', async () => {
    const roto: SharedStore = {
      async get() { throw new Error('redis caído') },
      async set() { throw new Error('redis caído') },
    }
    const cache = new TTLCache<string>(60_000, { shared: roto, namespace: 'bmo:test' })
    expect(await cache.resolve('k', async () => 'v')).toBe('v')
  })

  test('JSON corrupto en el almacén no rompe: se vuelve a producir', async () => {
    const { store } = fakeStore({ 'bmo:test:k': 'esto no es json' })
    const cache = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:test' })
    expect(await cache.resolve('k', async () => 'v')).toBe('v')
  })

  test('un almacén colgado no cuelga la resolución', async () => {
    // Sin el presupuesto de lectura, un Redis lento frenaría CADA reproducción.
    const colgado: SharedStore = {
      get: () => new Promise(() => {}),   // nunca resuelve
      async set() {},
    }
    const cache = new TTLCache<string>(60_000, { shared: colgado, namespace: 'bmo:test' })
    const t0 = Date.now()
    expect(await cache.resolve('k', async () => 'v')).toBe('v')
    expect(Date.now() - t0).toBeLessThan(2_000)
  })

  test('sin almacén compartido se comporta como antes', async () => {
    const cache = new TTLCache<string>(60_000)
    expect(await cache.resolve('k', async () => 'v')).toBe('v')
    expect(await cache.resolve('k', async () => 'otro')).toBe('v')
  })
})

// El resto de los tests inyecta un store falso, así que el código que realmente
// habla por red quedaría sin cubrir. Acá se levanta un servidor que responde
// como Upstash y se ejercita el protocolo de verdad: método, Authorization,
// forma del comando en el body y lectura de `result`.
describe('redisRestStore — protocolo contra un servidor real', () => {
  function upstashLike() {
    const data = new Map<string, string>()
    const seen: { auth?: string; method: string; body: unknown }[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json()
        seen.push({ auth: req.headers.get('authorization') ?? undefined, method: req.method, body })
        const [cmd, key, value] = body as string[]
        if (cmd === 'GET') return Response.json({ result: data.get(key) ?? null })
        if (cmd === 'SET') { data.set(key, value); return Response.json({ result: 'OK' }) }
        return Response.json({ error: `comando inesperado: ${cmd}` })
      },
    })
    return { server, data, seen, url: `http://localhost:${server.port}` }
  }

  test('SET y GET hacen ida y vuelta con el valor intacto', async () => {
    const { server, url, seen } = upstashLike()
    try {
      const store = redisRestStore(url, 'token-secreto')
      const payload = JSON.stringify({ value: { url: 'https://cdn/x.mkv' }, expires: Date.now() + 1000 })

      await store.set('bmo:stream:v2:movie:550', payload, 30_000)
      expect(await store.get('bmo:stream:v2:movie:550')).toBe(payload)

      expect(seen[0].method).toBe('POST')
      expect(seen[0].auth).toBe('Bearer token-secreto')
      // El TTL viaja como PX (milisegundos), no como EX.
      expect(seen[0].body).toEqual(['SET', 'bmo:stream:v2:movie:550', payload, 'PX', 30000])
      expect(seen[1].body).toEqual(['GET', 'bmo:stream:v2:movie:550'])
    } finally {
      server.stop(true)
    }
  })

  test('una clave que no existe devuelve null, no rompe', async () => {
    const { server, url } = upstashLike()
    try {
      expect(await redisRestStore(url, 't').get('no-existe')).toBeNull()
    } finally {
      server.stop(true)
    }
  })

  test('un error de Redis se propaga como excepción (el cache lo absorbe)', async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ error: 'WRONGTYPE' }) })
    try {
      await expect(redisRestStore(`http://localhost:${server.port}`, 't').get('k')).rejects.toThrow('WRONGTYPE')
    } finally {
      server.stop(true)
    }
  })

  test('un 500 del servidor también es excepción', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('boom', { status: 500 }) })
    try {
      await expect(redisRestStore(`http://localhost:${server.port}`, 't').get('k')).rejects.toThrow('redis 500')
    } finally {
      server.stop(true)
    }
  })

  test('un TTLCache real contra ese servidor comparte entre "instancias"', async () => {
    // Dos TTLCache distintos = dos instancias de Vercel. La segunda no debe
    // producir nada: se lo lleva del almacén que pobló la primera.
    const { server, url } = upstashLike()
    try {
      const store = redisRestStore(url, 't')
      const instanciaA = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:it' })
      const instanciaB = new TTLCache<string>(60_000, { shared: store, namespace: 'bmo:it' })

      expect(await instanciaA.resolve('movie:550', async () => 'resuelto-por-A')).toBe('resuelto-por-A')
      await tick()

      let producidoEnB = 0
      const v = await instanciaB.resolve('movie:550', async () => { producidoEnB++; return 'resuelto-por-B' })
      expect(v).toBe('resuelto-por-A')
      expect(producidoEnB).toBe(0)
    } finally {
      server.stop(true)
    }
  })
})

describe('sharedStoreFromEnv', () => {
  test('sin variables devuelve undefined (todo sigue andando local)', () => {
    expect(sharedStoreFromEnv({})).toBeUndefined()
    expect(sharedStoreFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x' })).toBeUndefined()
  })

  test('acepta el naming de Upstash y el de Vercel KV', () => {
    expect(sharedStoreFromEnv({
      UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't',
    })).toBeDefined()
    expect(sharedStoreFromEnv({
      KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't',
    })).toBeDefined()
  })
})
