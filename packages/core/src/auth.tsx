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
  updateProfile: (profileId: string, patch: { name?: string; avatar?: string }) => Promise<boolean>
  // El PIN se pone y se comprueba en el servidor (RPC): el hash nunca llega al
  // cliente. Ver supabase/002_profile_pin.sql.
  setProfilePin: (profileId: string, pin: string | null) => Promise<boolean>
  verifyProfilePin: (profileId: string, pin: string) => Promise<boolean>
  // Contraseña de la CUENTA (no el PIN del perfil): se exige antes de borrar,
  // que es la única acción irreversible de esta pantalla.
  verifyAccountPassword: (password: string) => Promise<boolean>
  deleteProfile: (profileId: string) => Promise<boolean>
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
    if (p) {
      await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, p.id)
      // Sync en segundo plano: migra lo que hubiera en el teléfono, reintenta
      // el outbox y baja el estado del servidor. No se espera — las lecturas
      // son locales, así que la UI ya puede pintar mientras esto corre.
      import('./library').then((lib) => lib.syncLibrary()).catch(() => {})
    } else {
      await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY)
    }
  }, [])

  const loadProfiles = useCallback(async (retry = true): Promise<Profile[]> => {
    // Columnas explícitas, NO `*`: el SELECT de `pin_hash` está revocado a
    // nivel de columna (ver 002_profile_pin.sql) y un `*` haría fallar la
    // consulta entera con "permission denied for column".
    const { data, error } = await supabase
      .from('profiles')
      .select('id, account_id, name, avatar, is_kids, created_at, has_pin')
      .order('created_at', { ascending: true })
    if (error) {
      // El access token pudo vencer estando la app cerrada. getSession() no
      // refresca, así que ante "JWT expired" refrescamos y reintentamos UNA vez.
      // Si el refresh token también murió, refreshSession devuelve sesión null y
      // caemos al warn (el flujo de login toma la posta).
      if (retry && /jwt|expired|token/i.test(error.message)) {
        const { data: r, error: rErr } = await supabase.auth.refreshSession()
        console.warn('[auth] refresh tras JWT expired →', r?.session ? 'OK' : 'FALLÓ', rErr?.message ?? '')
        if (r?.session) return loadProfiles(false)
      }
      console.warn('[auth] no se pudieron cargar perfiles:', error.message); return []
    }
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
      let session = data.session
      // getSession() NO refresca: devuelve la sesión persistida tal cual. Si el
      // access token ya venció (app cerrada un rato), consultar con él da
      // "JWT expired" y no cargan los perfiles. Lo refrescamos ACÁ, antes de
      // cualquier query, en vez de depender de que el auto-refresh en segundo
      // plano le gane la carrera. Si el refresh token también murió, refreshSession
      // devuelve sesión null y cae al flujo de login.
      const expMs = session?.expires_at ? session.expires_at * 1000 : 0
      if (session && expMs && expMs < Date.now()) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (cancelled) return
        session = refreshed.session
      }
      setSession(session)
      if (session) await loadProfiles()
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

  const setProfilePin = useCallback(async (profileId: string, pin: string | null) => {
    const { error } = await supabase.rpc('set_profile_pin', { p_profile: profileId, p_pin: pin })
    if (error) { console.warn('[auth] setProfilePin:', error.message); return false }
    await loadProfiles() // refresca has_pin para que la UI muestre el candado
    return true
  }, [loadProfiles])

  const verifyProfilePin = useCallback(async (profileId: string, pin: string) => {
    const { data, error } = await supabase.rpc('verify_profile_pin', { p_profile: profileId, p_pin: pin })
    if (error) { console.warn('[auth] verifyProfilePin:', error.message); return false }
    return data === true
  }, [])

  const updateProfile = useCallback(async (
    profileId: string,
    patch: { name?: string; avatar?: string }
  ) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', profileId)
    if (error) { console.warn('[auth] updateProfile:', error.message); return false }
    const list = await loadProfiles()
    // Si se editó el perfil activo hay que refrescar el objeto en memoria: si
    // no, el header seguiría mostrando el nombre y el avatar viejos.
    const fresh = list.find((p) => p.id === profileId)
    if (fresh && activeProfileId === profileId) setProfile(fresh)
    return true
  }, [loadProfiles])

  // Supabase no expone un "verificar contraseña" suelto, así que se reintenta
  // el login con el mismo correo: si pasa, la contraseña es correcta. Refresca
  // la sesión del mismo usuario, o sea que es inofensivo.
  const verifyAccountPassword = useCallback(async (password: string) => {
    const email = session?.user.email
    if (!email) return false // cuentas de Apple sin correo: no hay contraseña que validar
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return !error
  }, [session])

  const deleteProfile = useCallback(async (profileId: string) => {
    // El borrado en la base arrastra en cascada lista, progreso, vistos y
    // ajustes (on delete cascade en el esquema).
    const { error } = await supabase.from('profiles').delete().eq('id', profileId)
    if (error) { console.warn('[auth] deleteProfile:', error.message); return false }

    // Y el caché local del dispositivo, que no está en la base.
    import('./library').then((lib) => lib.clearProfileCache(profileId)).catch(() => {})

    // Si era el perfil activo hay que soltarlo: dejarlo apuntando a una fila
    // borrada haría fallar toda escritura por RLS, sin dar ninguna pista.
    if (activeProfileId === profileId) await applyProfile(null)
    await loadProfiles()
    return true
  }, [applyProfile, loadProfiles])

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
      updateProfile,
      setProfilePin,
      verifyProfilePin,
      verifyAccountPassword,
      deleteProfile,
      signOut,
    }}>
      {children}
    </Ctx.Provider>
  )
}
