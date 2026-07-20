import { useState } from 'react'
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@bmo/core/auth'
import { AVATARS, DEFAULT_AVATAR } from '@bmo/core/avatars'
import type { Profile } from '@bmo/core/supabase'
import { Keyboard } from '@/bmo/Keyboard'
import { FocusButton } from '@/bmo/FocusButton'
import { PinPad, PIN_LENGTH } from '@/bmo/PinPad'
import { ProfileAvatar } from '@/bmo/ProfileAvatar'
import { useFocusScale } from '@/bmo/useFocusScale'
import { colors, heroTitle, layout, rowHeading, safe } from '@/bmo/theme'

const AVATAR = 116

function ProfileTile({
  profile,
  onPress,
}: {
  profile: Profile
  onPress: (p: Profile) => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.08)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={() => onPress(profile)} style={styles.tileHit}>
      {({ focused }) => (
        <Animated.View style={[styles.tile, { transform: [{ scale }] }]}>
          <ProfileAvatar avatar={profile.avatar} size={AVATAR} selected={focused} />
          <View style={styles.tileNameRow}>
            {/* El candado va junto al nombre y no sobre el avatar: sobre la
                imagen se pierde con avatares claros. */}
            {profile.has_pin && (
              <Ionicons name="lock-closed" size={12} color={colors.textDim} />
            )}
            <Text style={[styles.tileName, focused && styles.tileNameFocused]} numberOfLines={1}>
              {profile.name}
            </Text>
          </View>
        </Animated.View>
      )}
    </Pressable>
  )
}

function AddTile({ onPress }: { onPress: () => void }) {
  const { scale, onFocus, onBlur } = useFocusScale(1.08)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={onPress} style={styles.tileHit}>
      {({ focused }) => (
        <Animated.View style={[styles.tile, { transform: [{ scale }] }]}>
          <View style={[styles.add, focused && styles.addFocused, { width: AVATAR, height: AVATAR }]}>
            <Ionicons name="add" size={44} color={focused ? '#000' : colors.textDim} />
          </View>
          <Text style={[styles.tileName, focused && styles.tileNameFocused]}>Nuevo</Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

function AvatarChoice({
  avatarKey,
  selected,
  onPress,
}: {
  avatarKey: string
  selected: boolean
  onPress: () => void
}) {
  const { scale, onFocus, onBlur } = useFocusScale(1.1)

  return (
    <Pressable onFocus={onFocus} onBlur={onBlur} onPress={onPress}>
      {({ focused }) => (
        <Animated.View style={{ transform: [{ scale }] }}>
          <ProfileAvatar avatar={avatarKey} size={64} selected={focused || selected} />
        </Animated.View>
      )}
    </Pressable>
  )
}

export default function ProfilesScreen() {
  const { profiles, selectProfile, createProfile, verifyProfilePin, loading } = useAuth()

  // Tres modos en una pantalla: elegir, desbloquear con PIN, o crear. Van como
  // estados y no como rutas distintas para no meter transiciones de stack en
  // medio de algo que el usuario percibe como un solo paso.
  const [locked, setLocked] = useState<Profile | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAvatar, setNewAvatar] = useState(DEFAULT_AVATAR)
  const [busy, setBusy] = useState(false)

  async function pick(p: Profile) {
    if (p.has_pin) {
      setLocked(p)
      setPin('')
      setPinError(null)
      return
    }
    await selectProfile(p)
  }

  async function onPinChange(v: string) {
    setPin(v)
    setPinError(null)
    if (v.length !== PIN_LENGTH || !locked) return
    setBusy(true)
    const ok = await verifyProfilePin(locked.id, v)
    setBusy(false)
    if (ok) {
      await selectProfile(locked)
      return
    }
    setPin('')
    setPinError('PIN incorrecto')
  }

  async function submitNew() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const created = await createProfile(name, newAvatar)
    setBusy(false)
    if (created) {
      setCreating(false)
      setNewName('')
      setNewAvatar(DEFAULT_AVATAR)
      await selectProfile(created)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    )
  }

  // ── Desbloquear ────────────────────────────────────────────────────────────
  if (locked) {
    return (
      <View style={styles.center}>
        <PinPad
          value={pin}
          onChange={onPinChange}
          title={`PIN de ${locked.name}`}
          subtitle={`Escribí los ${PIN_LENGTH} dígitos`}
          error={pinError}
        />
        <View style={styles.backRow}>
          <FocusButton label="Volver" onPress={() => setLocked(null)} />
        </View>
      </View>
    )
  }

  // ── Crear ──────────────────────────────────────────────────────────────────
  if (creating) {
    return (
      <View style={styles.createWrap}>
        <View style={styles.left}>
          <Keyboard
            defaultMode="upper"
            onChar={(c) => setNewName((s) => s + c)}
            onBackspace={() => setNewName((s) => s.slice(0, -1))}
            onSpace={() => setNewName((s) => (s ? s + ' ' : s))}
            onClear={() => setNewName('')}
          />
        </View>

        <View style={styles.right}>
          <Text style={styles.title}>Nuevo perfil</Text>

          <View style={styles.nameField}>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <Text style={[styles.fieldValue, !newName && styles.fieldEmpty]} numberOfLines={1}>
              {newName || '—'}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Avatar</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
            {AVATARS.map((a) => (
              <AvatarChoice
                key={a.key}
                avatarKey={a.key}
                selected={a.key === newAvatar}
                onPress={() => setNewAvatar(a.key)}
              />
            ))}
          </ScrollView>

          <View style={styles.createActions}>
            {busy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <FocusButton label="Crear" primary onPress={submitNew} />
                <FocusButton label="Cancelar" onPress={() => setCreating(false)} />
              </>
            )}
          </View>
        </View>
      </View>
    )
  }

  // ── Elegir ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.title}>¿Quién está viendo?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
        {profiles.map((p) => (
          <ProfileTile key={p.id} profile={p} onPress={pick} />
        ))}
        <AddTile onPress={() => setCreating(true)} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...heroTitle, fontSize: 34, textAlign: 'center', marginBottom: 30 },
  tiles: { paddingHorizontal: safe.horizontal, gap: 30, paddingVertical: 16 },
  tileHit: { alignItems: 'center' },
  tile: { alignItems: 'center', width: AVATAR },
  tileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  tileName: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  tileNameFocused: { color: colors.text },
  add: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFocused: { backgroundColor: '#fff', borderColor: '#fff', borderStyle: 'solid' },
  backRow: { marginTop: 24, flexDirection: 'row' },

  createWrap: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
    paddingTop: safe.top,
    paddingHorizontal: safe.horizontal,
    gap: 44,
  },
  left: { width: 258 },
  right: { flex: 1, paddingTop: 4 },
  nameField: {
    borderRadius: layout.radius,
    backgroundColor: 'rgba(120,120,128,0.24)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textDim, marginBottom: 3 },
  fieldValue: { fontSize: 19, fontWeight: '600', color: colors.text },
  fieldEmpty: { color: 'rgba(235,235,245,0.3)' },
  sectionLabel: { ...rowHeading, fontSize: 15, marginBottom: 10 },
  avatarRow: { gap: 14, paddingVertical: 8, paddingRight: 20 },
  createActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
})
