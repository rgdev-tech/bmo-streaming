# bmo-stream-proxy

Proxy edge (Cloudflare Workers) que el API usa para resolver streams con
`@movie-web/providers`. Evita los bloqueos SSL/CORS/IP que hacen fallar a los
proveedores cuando se llaman directo desde un servidor.

## Desplegar (gratis, ~3 min)

```bash
cd apps/proxy
npm install            # o: bun install
npx wrangler login     # abre el navegador para conectar tu cuenta Cloudflare
npx wrangler deploy
```

Al terminar te imprime la URL pública, p.ej.:

```
https://bmo-stream-proxy.tu-usuario.workers.dev
```

## Conectar con el API

Pon esa URL en la variable de entorno del API:

- **Local:** en `apps/api/.env`
  ```
  STREAM_PROXY_URL=https://bmo-stream-proxy.tu-usuario.workers.dev
  ```
- **Vercel:** Project → Settings → Environment Variables → `STREAM_PROXY_URL`

Listo. El resolver enruta automáticamente por el proxy y los proveedores empiezan
a devolver streams.

## Probar

```bash
curl "https://bmo-stream-proxy.tu-usuario.workers.dev?destination=https://example.com"
```

Debe devolver el HTML de example.com con cabeceras CORS.
