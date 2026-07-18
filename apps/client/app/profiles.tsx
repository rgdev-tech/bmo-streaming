import { useState } from 'react'
import { View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { Touchable } from '@/components/Touchable'
import type { Profile } from '@/lib/supabase'

const AVATARS = ['🍿', '🎬', '👾', '🦊', '🐙', '🌮', '🚀', '🎧', '🐲', '⚡']
const MAX_PROFILES = 5   // igual que el tope del trigger en el esquema

export default function ProfilesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { profiles, profile, selectProfile, createProfile, signOut } = useAuth()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(p: Profile) {
    await selectProfile(p)
    router.replace('/')
  }

  async function submit() {
    if (!name.trim()) { setError('Ponle un nombre al perfil'); return }
    setBusy(true); setError(null)
    const created = await createProfile(name.trim(), avatar)
    setBusy(false)
    if (!created) { setError('No se pudo crear (¿nombre repetido?)'); return }
    setName(''); setCreating(false)
    await pick(created)
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.title}>{creating ? 'Nuevo perfil' : '¿Quién está viendo?'}</Text>

        {creating ? (
          <View style={styles.form}>
            <View style={styles.avatarRow}>
              {AVATARS.map((a) => (
                <Touchable
                  key={a}
                  scaleTo={0.9}
                  haptic="selection"
                  style={[styles.avatarOption, avatar === a && styles.avatarOptionActive]}
                  onPress={() => setAvatar(a)}
                >
                  <Text style={styles.avatarEmoji}>{a}</Text>
                </Touchable>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Nombre"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={name}
              onChangeText={setName}
              maxLength={30}
              autoFocus
            />
            {!!error && <Text style={styles.error}>{error}</Text>}

            <Touchable style={styles.primaryBtn} scaleTo={0.97} haptic="medium" onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Crear</Text>}
            </Touchable>
            <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={() => { setCreating(false); setError(null) }}>
              <Text style={styles.ghostText}>Cancelar</Text>
            </Touchable>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {profiles.map((p) => (
                <Touchable key={p.id} scaleTo={0.94} haptic="light" style={styles.profileCell} onPress={() => pick(p)}>
                  <View style={[styles.avatarBox, profile?.id === p.id && styles.avatarBoxActive]}>
                    <Text style={styles.avatarBoxEmoji}>{p.avatar}</Text>
                  </View>
                  <Text style={styles.profileName} numberOfLines={1}>{p.name}</Text>
                </Touchable>
              ))}

              {profiles.length < MAX_PROFILES && (
                <Touchable scaleTo={0.94} haptic="light" style={styles.profileCell} onPress={() => setCreating(true)}>
                  <View style={[styles.avatarBox, styles.addBox]}>
                    <SymbolView name="plus" tintColor="rgba(255,255,255,0.6)" style={styles.addIcon} />
                  </View>
                  <Text style={styles.profileName}>Añadir</Text>
                </Touchable>
              )}
            </View>

            <Touchable style={styles.signOut} scaleTo={0.98} haptic="light" onPress={signOut}>
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </Touchable>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { paddingHorizontal: 24 },
  title: {
    color: '#fff', fontSize: 30, fontWeight: '800',
    letterSpacing: -0.8, textAlign: 'center', marginBottom: 40,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 24 },
  profileCell: { alignItems: 'center', width: 104 },
  avatarBox: {
    width: 96, height: 96, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  avatarBoxActive: { borderColor: '#fff' },
  addBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  avatarBoxEmoji: { fontSize: 44 },
  addIcon: { width: 26, height: 26 },
  profileName: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginTop: 10 },

  form: { gap: 12 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 12 },
  avatarOption: {
    width: 54, height: 54, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  avatarOptionActive: { borderColor: '#fff' },
  avatarEmoji: { fontSize: 26 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15,
    color: '#fff', fontSize: 16,
  },
  error: { color: '#ff6b6b', fontSize: 14, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#fff', borderRadius: 27, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', minHeight: 54, marginTop: 4,
  },
  primaryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  ghostBtn: { alignItems: 'center', paddingVertical: 12 },
  ghostText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },

  signOut: { marginTop: 60, alignItems: 'center' },
  signOutText: { color: 'rgba(255,255,255,0.45)', fontSize: 15 },
})
