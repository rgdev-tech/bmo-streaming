import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured, type Profile } from './supabase'

// El perfil activo se recuerda entre arranques: obligar a elegirlo cada vez
// sería molesto en el caso normal (un solo perfil). El selector queda a mano
// en el avatar del header.
const ACTIVE_PROFILE_KEY = 'bmo:activeProfileId'

type AuthState = {
  // `loading` cubre la restauración de sesión Y la carga de perfiles: mientras
  // sea true no se puede decidir a dónde mandar al usuario sin hacerlo
  // parpadear entre login y app.
  loading: boolean
  session: Session | null
  profiles: Profile[]
  profile: Profile | null
  selectProfile: (p: Profile) => Promise<void>
  refreshProfiles: () => Promise<Profile[]>
  createProfile: (name: string, avatar: string) => Promise<Profile | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth fuera de <AuthProvider>')
  return ctx
}

// Id del perfil activo para código que NO es de React (lib/library.ts hace
// sus escrituras desde funciones sueltas, no desde componentes). Se mantiene
// en un módulo-global sincronizado por el provider en vez de pasarlo por
// parámetro a las ~15 funciones de la librería.
let activeProfileId: string | null = null
export function getActiveProfileId(): string | null {
  return activeProfileId
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)

  const applyProfile = useCallback(async (p: Profile | null) => {
    activeProfileId = p?.id ?? null
    setProfile(p)
    if (p) await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, p.id)
    else await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY)
  }, [])

  const loadProfiles = useCallback(async (): Promise<Profile[]> => {
    const { data, error } = await supabase
      .from('profiles').select('*').order('created_at', { ascending: true })
    if (error) { console.warn('[auth] no se pudieron cargar perfiles:', error.message); return [] }
    const list = (data ?? []) as Profile[]
    setProfiles(list)

    // Se re-resuelve el perfil activo contra la lista fresca: el guardado pudo
    // haberse borrado en otro dispositivo, y quedarse apuntando a un id
    // inexistente rompería toda escritura por RLS sin dar una pista.
    const savedId = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY)
    const match = list.find((p) => p.id === savedId)
    await applyProfile(match ?? (list.length === 1 ? list[0] : null))
    return list
  }, [applyProfile])

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) await loadProfiles()
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (cancelled) return
      setSession(s)
      if (s) {
        await loadProfiles()
      } else {
        setProfiles([])
        await applyProfile(null)
      }
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [loadProfiles, applyProfile])

  const createProfile = useCallback(async (name: string, avatar: string) => {
    if (!session) return null
    const { data, error } = await supabase
      .from('profiles')
      .insert({ account_id: session.user.id, name: name.trim(), avatar })
      .select().single()
    if (error) { console.warn('[auth] createProfile:', error.message); return null }
    await loadProfiles()
    return data as Profile
  }, [session, loadProfiles])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfiles([])
    await applyProfile(null)
  }, [applyProfile])

  return (
    <Ctx.Provider value={{
      loading, session, profiles, profile,
      selectProfile: applyProfile,
      refreshProfiles: loadProfiles,
      createProfile,
      signOut,
    }}>
      {children}
    </Ctx.Provider>
  )
}
