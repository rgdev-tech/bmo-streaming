/**
 * Proxy edge para el resolver de streams (compatible con @movie-web/providers
 * makeSimpleProxyFetcher). Reenvía la petición al `destination`, traduciendo los
 * headers sensibles que el navegador/servidor no puede mandar directo, y expone
 * la URL final + cookies de vuelta. Despliega gratis en Cloudflare Workers.
 *
 *   npx wrangler deploy   →   https://bmo-stream-proxy.<tu-usuario>.workers.dev
 *   Pon esa URL en STREAM_PROXY_URL del API.
 */

// Headers que el cliente envía con prefijo X-* → nombre real hacia el destino
const HEADER_MAP: Record<string, string> = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-x-real-ip': 'x-real-ip',
}

// Headers "normales" que sí reenviamos tal cual si vienen
const PASS_THROUGH = new Set(['accept', 'accept-language', 'content-type', 'range'])

function cors(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    ...extra,
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() })
    }

    const url = new URL(request.url)
    const destination = url.searchParams.get('destination')
    if (!destination) {
      return new Response('Missing ?destination', { status: 400, headers: cors() })
    }

    // Construir headers hacia el destino
    const headers = new Headers()
    for (const [key, value] of request.headers) {
      const lower = key.toLowerCase()
      if (HEADER_MAP[lower]) headers.set(HEADER_MAP[lower], value)
      else if (PASS_THROUGH.has(lower)) headers.set(lower, value)
    }
    if (!headers.has('user-agent')) {
      headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
    }

    let upstream: Response
    try {
      upstream = await fetch(destination, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'follow',
      })
    } catch (e) {
      return new Response(`Proxy fetch failed: ${(e as Error).message}`, { status: 502, headers: cors() })
    }

    // Leemos el cuerpo completo → así se descomprime aquí (gzip/br) y el cliente
    // recibe texto plano. El proxy solo maneja peticiones pequeñas de scraping
    // (HTML/JSON/manifests), nunca el vídeo, así que bufferizar es seguro.
    const body = await upstream.arrayBuffer()

    const respHeaders = new Headers()
    // Conservamos solo headers seguros (content-type) y añadimos los nuestros
    const ct = upstream.headers.get('content-type')
    if (ct) respHeaders.set('content-type', ct)
    for (const [k, v] of Object.entries(cors())) respHeaders.set(k, v)
    respHeaders.set('X-Final-Destination', upstream.url || destination)
    const setCookie = upstream.headers.get('set-cookie')
    if (setCookie) respHeaders.set('X-Set-Cookie', setCookie)

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  },
}
