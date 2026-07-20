import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'

// La anon key es pública POR DISEÑO: viaja en el bundle de la app y cualquiera
// puede leerla. Lo que protege los datos es el RLS del esquema (ver
// supabase/schema.sql), no el secreto de esta clave. La que NUNCA debe estar
// acá es la `service_role`, que saltea el RLS entero.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

if (!supabaseConfigured) {
  console.warn(
    '⚠️  Supabase sin configurar — define EXPO_PUBLIC_SUPABASE_URL y ' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY en el .env.local de la app'
  )
}

// Placeholders sintácticamente válidos cuando falta configuración. Sin esto,
// createClient('') tira "supabaseUrl is required" al importar el módulo, y como
// medio árbol de imports pasa por acá, la app entera se cae en el arranque en
// vez de arrancar sin sesión. El warning de arriba ya avisa qué pasa; quien
// necesite saber si hay backend consulta `supabaseConfigured`.
const url = SUPABASE_URL || 'http://localhost:54321'
const key = SUPABASE_ANON_KEY || 'sin-configurar'

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No hay URL que inspeccionar en React Native (esto es para el flujo web).
    detectSessionInUrl: false,
  },
})

// El refresco automático de token corre con un timer: si sigue vivo con la app
// en segundo plano, gasta batería y puede pegarle a la red justo cuando iOS
// está por suspender el proceso. Se pausa al salir y se reanuda al volver.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})

// ── Tipos de las tablas (espejo de supabase/schema.sql) ─────────────────────

export type Profile = {
  id: string
  account_id: string
  name: string
  avatar: string
  is_kids: boolean
  created_at: string
  // Derivada en la base (pin_hash is not null). El hash en sí nunca llega acá:
  // su SELECT está revocado y la verificación es por RPC.
  has_pin: boolean
}

export type ListItemRow = {
  profile_id: string
  tmdb_id: number
  media_type: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path: string | null
  added_at: string
}

// season/episode son 0 para películas (forman parte de la PK y no pueden ser
// NULL) — ver el comentario en el esquema.
export type ProgressRow = {
  profile_id: string
  tmdb_id: number
  media_type: 'movie' | 'tv'
  season: number
  episode: number
  title: string
  poster_path: string | null
  backdrop_path: string | null
  position_s: number
  duration_s: number
  updated_at: string
}

export type WatchedEpisodeRow = {
  profile_id: string
  tmdb_id: number
  season: number
  episode: number
  watched_at: string
}

export type ProfileSettingsRow = {
  profile_id: string
  audio_lang: 'original' | 'latino'
  subtitle_style: { size: string; color: string; background: string }
  updated_at: string
}
