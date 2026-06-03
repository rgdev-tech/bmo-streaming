import Constants from 'expo-constants'

/**
 * Deriva la URL del backend automáticamente:
 * Metro sirve el bundle desde la IP del Mac (hostUri = "192.168.x.x:8081"),
 * usamos esa misma IP con el puerto 3000 del API.
 * Si defines EXPO_PUBLIC_API_URL, esa tiene prioridad.
 */
function resolveApiUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL
  if (override) return override

  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    ''
  const host = hostUri.split(':')[0]
  if (host) return `http://${host}:3000`

  return 'http://localhost:3000'
}

export const API_URL = resolveApiUrl()

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) {
    throw new Error(`API ${res.status} en ${path}`)
  }
  return res.json() as Promise<T>
}
