import app from '../dist/index.js'

export default async function handler(req, res) {
  const url = `https://${req.headers.host}${req.url}`
  const headers = new Headers(req.headers)

  let body = undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  const request = new Request(url, { method: req.method, headers, body })
  const response = await app(request)

  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  const buffer = await response.arrayBuffer()
  res.end(Buffer.from(buffer))
}
