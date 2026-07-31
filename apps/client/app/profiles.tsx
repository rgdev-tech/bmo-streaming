import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator,
  Animated, Easing, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { AVATARS, DEFAULT_AVATAR } from '@/lib/avatars'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { ProfileEditor } from '@/components/ProfileEditor'
import { Touchable } from '@/components/Touchable'
import { PinPad, PIN_LENGTH } from '@/components/PinPad'
import type { Profile } from '@/lib/supabase'
import { colors, gradients } from '@/lib/theme'

const MAX_PROFILES = 5 // igual que el tope del trigger en el esquema
const { width } = Dimensions.get('window')
// Tres por fila con aire a los costados; el avatar manda sobre el ancho.
const CELL = Math.min(104, (width - 48 - 32) / 3)

export default function ProfilesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const {
    profiles, profile, selectProfile, createProfile, updateProfile,
    setProfilePin, verifyProfilePin, verifyAccountPassword, deleteProfile, signOut,
  } = useAuth()
  const [creating, setCreating] = useState(false)
  // Perfil que pidió PIN y está esperando a que lo desbloqueen.
  const [locked, setLocked] = useState<Profile | null>(null)
  const [editing, setEditing] = useState(false)
  // Perfil abierto en el editor de detalle.
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  // Perfil marcado para borrar, esperando confirmación con contraseña.
  const [deleting, setDeleting] = useState<Profile | null>(null)
  // Perfil al que se le está definiendo/quitando el PIN desde el editor.
  const [pinTarget, setPinTarget] = useState<Profile | null>(null)

  // El editor trabaja sobre la copia fresca de la lista: si no, tras guardar
  // seguiría mostrando los datos con los que se abrió.
  const editProfile = editTarget ? profiles.find((p) => p.id === editTarget.id) ?? null : null

  // Entrada suave, igual que en el login.
  const enter = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start()
  }, [])
  const rise = (offset: number) => ({
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12 + offset, 0] }) }],
  })

  async function openProfile(p: Profile) {
    await selectProfile(p)
    router.replace('/')
  }

  // En modo edición el toque abre el detalle en vez de entrar al perfil.
  function pick(p: Profile) {
    if (editing) { setEditTarget(p); return }
    if (p.has_pin) { setLocked(p); return }
    return openProfile(p)
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={gradients.ambient} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      {pinTarget ? (
        // Con PIN ya puesto se quita directo; si no, se define uno nuevo.
        pinTarget.has_pin ? (
          <RemovePinStep
            profile={pinTarget}
            onSetPin={setProfilePin}
            onDone={() => setPinTarget(null)}
            insets={insets}
          />
        ) : (
          <SetPinStep
            profile={pinTarget}
            onSetPin={setProfilePin}
            onDone={() => setPinTarget(null)}
            insets={insets}
          />
        )
      ) : editProfile ? (
        <ProfileEditor
          profile={editProfile}
          canDelete={profiles.length > 1}
          onSave={(patch) => updateProfile(editProfile.id, patch)}
          onManagePin={() => setPinTarget(editProfile)}
          onDelete={() => setDeleting(editProfile)}
          onClose={() => { setEditTarget(null); setEditing(false) }}
          insets={insets}
        />
      ) : deleting ? (
        <DeleteProfile
          profile={deleting}
          onVerifyPassword={verifyAccountPassword}
          onDelete={deleteProfile}
          onDone={() => { setDeleting(null); setEditTarget(null); setEditing(false) }}
          onCancel={() => setDeleting(null)}
          insets={insets}
        />
      ) : locked ? (
        <UnlockProfile
          profile={locked}
          onVerify={verifyProfilePin}
          onUnlocked={() => { const p = locked; setLocked(null); return openProfile(p) }}
          onCancel={() => setLocked(null)}
          insets={insets}
        />
      ) : creating ? (
        <NewProfileForm
          onCancel={() => setCreating(false)}
          onCreate={createProfile}
          onSetPin={setProfilePin}
          onCreated={openProfile}
          insets={insets}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={rise(0)}>
            <Text style={styles.title}>¿Quién está viendo?</Text>
            <Text style={styles.subtitle}>Cada perfil guarda su propia lista y su progreso.</Text>
          </Animated.View>

          <Animated.View style={[styles.grid, rise(6)]}>
            {profiles.map((p) => (
              <Touchable key={p.id} scaleTo={0.93} haptic="light" style={styles.cell} onPress={() => pick(p)}>
                <View>
                  <ProfileAvatar
                    avatar={p.avatar}
                    size={CELL}
                    selected={!editing && profile?.id === p.id}
                  />
                  {editing ? (
                    <View style={styles.deleteBadge}>
                      <SymbolView name="trash.fill" tintColor="#fff" style={styles.lockIcon} />
                    </View>
                  ) : p.has_pin ? (
                    <View style={styles.lockBadge}>
                      <SymbolView name="lock.fill" tintColor="#000" style={styles.lockIcon} />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.name, profile?.id === p.id && styles.nameActive]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
              </Touchable>
            ))}

            {/* En edición se oculta: mezclar "crear" con "borrar" invita a
                tocar el que no era. */}
            {!editing && profiles.length < MAX_PROFILES && (
              <Touchable scaleTo={0.93} haptic="light" style={styles.cell} onPress={() => setCreating(true)}>
                <View style={[styles.addBox, { width: CELL, height: CELL, borderRadius: CELL / 2 }]}>
                  <SymbolView name="plus" tintColor={colors.textDim} style={styles.addIcon} />
                </View>
                <Text style={styles.name}>Añadir</Text>
              </Touchable>
            )}
          </Animated.View>

          {/* Solo con 2+ perfiles: borrar el único dejaría la cuenta sin
              ninguno, y el guard te devolvería acá a crear uno. */}
          {profiles.length > 1 && (
            <Animated.View style={rise(10)}>
              <Touchable
                style={styles.editBtn}
                scaleTo={0.97}
                haptic="light"
                onPress={() => setEditing((v) => !v)}
              >
                <Text style={[styles.editText, editing && styles.editTextOn]}>
                  {editing ? 'Listo' : 'Administrar perfiles'}
                </Text>
              </Touchable>
            </Animated.View>
          )}

          <Animated.View style={rise(12)}>
            <Touchable style={styles.signOut} scaleTo={0.97} haptic="light" onPress={signOut}>
              <SymbolView
                name="rectangle.portrait.and.arrow.right"
                tintColor={colors.textMuted}
                style={styles.signOutIcon}
              />
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </Touchable>
          </Animated.View>
        </ScrollView>
      )}
    </View>
  )
}

// ── Borrar perfil ───────────────────────────────────────────────────────────
// Pide la contraseña de la CUENTA, no el PIN del perfil: el PIN lo sabe quien
// usa ese perfil, y no debería poder borrarse a sí mismo ni a otro.

function DeleteProfile({
  profile, onVerifyPassword, onDelete, onDone, onCancel, insets,
}: {
  profile: Profile
  onVerifyPassword: (password: string) => Promise<boolean>
  onDelete: (profileId: string) => Promise<boolean>
  onDone: () => void
  onCancel: () => void
  insets: { top: number; bottom: number }
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!password || busy) return
    setBusy(true); setError(null)

    const ok = await onVerifyPassword(password)
    if (!ok) {
      setBusy(false)
      setError('Contraseña incorrecta')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      return
    }
    const deleted = await onDelete(profile.id)
    setBusy(false)
    if (!deleted) { setError('No se pudo eliminar el perfil'); return }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onDone()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <ScrollView
        // alignItems:'center' acá colapsaba el ancho del campo y del botón
        // (quedaban del tamaño de su contenido). Se centra solo la cabecera.
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 30 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.deleteHero}>
          <ProfileAvatar avatar={profile.avatar} size={84} />
        </View>
        <Text style={styles.deleteTitle}>Eliminar «{profile.name}»</Text>

        {/* Se enumera lo que se pierde: en cascada se van la lista, el
            progreso y los episodios vistos de ESTE perfil. */}
        <Text style={styles.deleteWarn}>
          Se borrarán su lista, su progreso y sus episodios vistos.
          Esta acción no se puede deshacer.
        </Text>

        <Text style={styles.deleteLabel}>Confirma con la contraseña de tu cuenta</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={colors.textFaint}
            value={password}
            onChangeText={(v) => { setPassword(v); if (error) setError(null) }}
            secureTextEntry
            autoCapitalize="none"
            autoFocus
            selectionColor="#fff"
            returnKeyType="go"
            onSubmitEditing={confirm}
          />
        </View>

        {!!error && (
          <View style={styles.banner}>
            <SymbolView name="exclamationmark.circle.fill" tintColor={colors.danger} style={styles.bannerIcon} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Touchable
          style={[styles.dangerBtn, !password && styles.dangerBtnOff]}
          scaleTo={0.97}
          haptic="heavy"
          onPress={confirm}
          disabled={!password || busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.dangerText}>Eliminar perfil</Text>}
        </Touchable>

        <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={onCancel}>
          <Text style={styles.ghostText}>Cancelar</Text>
        </Touchable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Quitar PIN ──────────────────────────────────────────────────────────────
// Se exige el PIN actual: si no, cualquiera con el teléfono desbloqueado
// entraría al editor y le sacaría el candado al perfil de otro.

function RemovePinStep({
  profile, onSetPin, onDone, insets,
}: {
  profile: Profile
  onSetPin: (profileId: string, pin: string | null) => Promise<boolean>
  onDone: () => void
  insets: { top: number; bottom: number }
}) {
  const { verifyProfilePin } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return
    let alive = true
    setBusy(true)
    verifyProfilePin(profile.id, pin).then(async (ok) => {
      if (!alive) return
      if (!ok) { setBusy(false); setError('PIN incorrecto'); setPin(''); return }
      await onSetPin(profile.id, null)
      if (alive) { setBusy(false); onDone() }
    })
    return () => { alive = false }
  }, [pin])

  return (
    <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
      <ProfileAvatar avatar={profile.avatar} size={78} />
      <View style={styles.unlockPad}>
        <PinPad
          value={pin}
          onChange={(v) => { setPin(v); if (error) setError(null) }}
          title="Quitar el PIN"
          subtitle={`Introduce el PIN actual de ${profile.name}`}
          error={error}
        />
      </View>
      <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={onDone}>
        <Text style={styles.ghostText}>Cancelar</Text>
      </Touchable>
    </View>
  )
}

// ── Desbloqueo ──────────────────────────────────────────────────────────────

function UnlockProfile({
  profile, onVerify, onUnlocked, onCancel, insets,
}: {
  profile: Profile
  onVerify: (profileId: string, pin: string) => Promise<boolean>
  onUnlocked: () => void
  onCancel: () => void
  insets: { top: number; bottom: number }
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Se verifica solo al completar los 4 dígitos: no hay botón de confirmar,
  // como en el desbloqueo de iOS.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return
    let alive = true
    setBusy(true)
    onVerify(profile.id, pin).then((ok) => {
      if (!alive) return
      setBusy(false)
      if (ok) { onUnlocked(); return }
      setError('PIN incorrecto')
      setPin('')
    })
    return () => { alive = false }
  }, [pin])

  return (
    <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
      <ProfileAvatar avatar={profile.avatar} size={78} />
      <View style={styles.unlockPad}>
        <PinPad
          value={pin}
          onChange={(v) => { setPin(v); if (error) setError(null) }}
          title={profile.name}
          subtitle="Introduce el PIN de este perfil"
          error={error}
        />
      </View>
      <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={onCancel}>
        <Text style={styles.ghostText}>Cancelar</Text>
      </Touchable>
    </View>
  )
}

// ── Formulario de perfil nuevo ──────────────────────────────────────────────
// Pantalla aparte y no un bloque más: mezclarla con el selector hacía que el
// teclado tapara los controles y que no quedara claro qué se estaba haciendo.

function NewProfileForm({
  onCancel, onCreate, onSetPin, onCreated, insets,
}: {
  onCancel: () => void
  onCreate: (name: string, avatar: string) => Promise<Profile | null>
  onSetPin: (profileId: string, pin: string | null) => Promise<boolean>
  onCreated: (p: Profile) => void
  insets: { top: number; bottom: number }
}) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR)
  const [wantsPin, setWantsPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Paso de PIN: el perfil ya existe, solo falta ponerle el candado.
  const [pinFor, setPinFor] = useState<Profile | null>(null)

  const canSubmit = name.trim().length > 0 && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    const created = await onCreate(name.trim(), avatar)
    setBusy(false)
    if (!created) { setError('No se pudo crear. ¿Ya usas ese nombre?'); return }
    // El PIN se pone DESPUÉS de crear porque la RPC necesita el id del perfil.
    if (wantsPin) { setPinFor(created); return }
    onCreated(created)
  }

  if (pinFor) {
    return (
      <SetPinStep
        profile={pinFor}
        onSetPin={onSetPin}
        onDone={() => onCreated(pinFor)}
        insets={insets}
      />
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 30 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Nuevo perfil</Text>
        <Text style={styles.subtitle}>Elige un icono y un nombre.</Text>

        {/* Vista previa: se ve el resultado antes de crear, en vez de tener
            que imaginarlo desde la cuadrícula. */}
        <View style={styles.preview}>
          <ProfileAvatar avatar={avatar} size={96} />
          <Text style={styles.previewName} numberOfLines={1}>
            {name.trim() || 'Sin nombre'}
          </Text>
        </View>

        <Text style={styles.label}>Icono</Text>
        {/* Fila única con scroll horizontal: la cuadrícula que envolvía dejaba
            una última fila desbalanceada, y ocupaba alto que el teclado
            necesita. El margen negativo hace que sangre hasta los bordes de la
            pantalla, como los carruseles de iOS. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.avatarRow}
          contentContainerStyle={styles.avatarRowContent}
        >
          {AVATARS.map((a) => {
            const on = a.key === avatar
            return (
              <Touchable key={a.key} scaleTo={0.88} haptic="selection" onPress={() => setAvatar(a.key)}>
                <View style={styles.avatarSlot}>
                  <ProfileAvatar avatar={a.key} size={62} selected={on} />
                  {on && (
                    <View style={styles.check}>
                      <SymbolView name="checkmark" tintColor="#000" style={styles.checkIcon} />
                    </View>
                  )}
                </View>
              </Touchable>
            )
          })}
        </ScrollView>

        <Text style={styles.label}>Nombre</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Ej. Diego"
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={setName}
            maxLength={30}
            autoFocus
            selectionColor="#fff"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>

        {/* Candado opcional. Fila tocable entera, como los switches de Ajustes. */}
        <Touchable style={styles.toggleRow} scaleTo={0.99} haptic="selection" onPress={() => setWantsPin((v) => !v)}>
          <SymbolView
            name={wantsPin ? 'lock.fill' : 'lock.open.fill'}
            tintColor={wantsPin ? '#fff' : colors.textMuted}
            style={styles.toggleIcon}
          />
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Proteger con PIN</Text>
            <Text style={styles.toggleSub}>Pedirá 4 dígitos para entrar a este perfil.</Text>
          </View>
          <View style={[styles.checkbox, wantsPin && styles.checkboxOn]}>
            {wantsPin && <SymbolView name="checkmark" tintColor="#000" style={styles.checkIcon} />}
          </View>
        </Touchable>

        {!!error && (
          <View style={styles.banner}>
            <SymbolView name="exclamationmark.circle.fill" tintColor={colors.danger} style={styles.bannerIcon} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Touchable
          style={[styles.primaryBtn, !canSubmit && styles.primaryBtnOff]}
          scaleTo={0.97}
          haptic="medium"
          onPress={submit}
          disabled={!canSubmit}
        >
          {busy
            ? <ActivityIndicator color="#000" />
            : (
              <Text style={[styles.primaryText, !canSubmit && styles.primaryTextOff]}>
                {wantsPin ? 'Continuar' : 'Crear perfil'}
              </Text>
            )}
        </Touchable>

        <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={onCancel}>
          <Text style={styles.ghostText}>Cancelar</Text>
        </Touchable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Definir PIN (crear + confirmar) ─────────────────────────────────────────

function SetPinStep({
  profile, onSetPin, onDone, insets,
}: {
  profile: Profile
  onSetPin: (profileId: string, pin: string | null) => Promise<boolean>
  onDone: () => void
  insets: { top: number; bottom: number }
}) {
  const [stage, setStage] = useState<'create' | 'confirm'>('create')
  const [first, setFirst] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Se pide dos veces: con 4 dígitos y sin feedback, un error de tipeo dejaría
  // el perfil bloqueado con un PIN que el usuario no conoce.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return

    if (stage === 'create') {
      setFirst(pin); setPin(''); setStage('confirm')
      return
    }
    if (pin !== first) {
      setError('Los PIN no coinciden'); setPin(''); setStage('create'); setFirst('')
      return
    }
    let alive = true
    setBusy(true)
    onSetPin(profile.id, pin).then((ok) => {
      if (!alive) return
      setBusy(false)
      if (ok) { onDone(); return }
      setError('No se pudo guardar el PIN')
      setPin(''); setStage('create'); setFirst('')
    })
    return () => { alive = false }
  }, [pin])

  return (
    <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
      <ProfileAvatar avatar={profile.avatar} size={78} />
      <View style={styles.unlockPad}>
        <PinPad
          value={pin}
          onChange={(v) => { setPin(v); if (error) setError(null) }}
          title={stage === 'create' ? 'Crea un PIN' : 'Confirma el PIN'}
          subtitle={stage === 'create'
            ? `4 dígitos para entrar a ${profile.name}`
            : 'Introdúcelo otra vez'}
          error={error}
        />
      </View>
      {/* Saltar deja el perfil creado y sin candado: ya existe, no hay vuelta
          atrás que ofrecer. */}
      <Touchable style={styles.ghostBtn} scaleTo={0.98} haptic="light" onPress={onDone}>
        <Text style={styles.ghostText}>Ahora no</Text>
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  unlockPad: { marginTop: 22, marginBottom: 8 },

  lockBadge: {
    position: 'absolute', right: 2, bottom: 2,
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: colors.bg,
  },
  lockIcon: { width: 11, height: 11 },
  deleteBadge: {
    position: 'absolute', right: 2, bottom: 2,
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: colors.bg,
  },

  editBtn: { alignItems: 'center', marginTop: 34, paddingVertical: 10 },
  editText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  editTextOn: { color: '#fff' },

  deleteTitle: {
    color: '#fff', fontSize: 22, fontWeight: '700',
    letterSpacing: -0.4, marginTop: 20, textAlign: 'center',
  },
  deleteWarn: {
    color: colors.textMuted, fontSize: 14.5, lineHeight: 21,
    textAlign: 'center', marginTop: 12, marginBottom: 32, paddingHorizontal: 8,
  },
  deleteHero: { alignItems: 'center' },
  deleteLabel: {
    color: colors.textMuted, fontSize: 12.5, fontWeight: '700',
    letterSpacing: 0.7, textTransform: 'uppercase',
    marginBottom: 12, marginLeft: 4,
  },
  dangerBtn: {
    backgroundColor: colors.danger, borderRadius: 28, alignSelf: 'stretch',
    paddingVertical: 17, alignItems: 'center', justifyContent: 'center',
    marginTop: 26, minHeight: 56,
  },
  dangerBtnOff: { backgroundColor: 'rgba(224,49,49,0.35)' },
  dangerText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: colors.fillSubtle,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.fill,
    paddingHorizontal: 16, paddingVertical: 15, marginTop: 18,
  },
  toggleIcon: { width: 18, height: 18 },
  toggleText: { flex: 1 },
  toggleTitle: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  toggleSub: { color: colors.textMuted, fontSize: 13, marginTop: 3, lineHeight: 17 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.textFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#fff', borderColor: '#fff' },

  fill: { flex: 1 },
  content: { paddingHorizontal: 24 },

  title: {
    color: '#fff', fontSize: 28, fontWeight: '800',
    letterSpacing: -0.8, textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted, fontSize: 14.5,
    textAlign: 'center', marginTop: 8, marginBottom: 38, lineHeight: 20,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 },
  cell: { alignItems: 'center', width: CELL + 8 },
  name: {
    color: colors.textDim, fontSize: 14,
    fontWeight: '600', marginTop: 11, textAlign: 'center',
  },
  nameActive: { color: '#fff' },
  addBox: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.fillSubtle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addIcon: { width: 24, height: 24 },

  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, marginTop: 56, paddingVertical: 10,
  },
  signOutIcon: { width: 15, height: 15 },
  signOutText: { color: colors.textMuted, fontSize: 15 },

  // Formulario
  preview: { alignItems: 'center', marginBottom: 34 },
  previewName: {
    color: '#fff', fontSize: 17, fontWeight: '700',
    marginTop: 13, letterSpacing: -0.2,
  },
  label: {
    color: colors.textMuted, fontSize: 12.5, fontWeight: '700',
    letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 12, marginLeft: 4,
  },
  // -24 cancela el padding del ScrollView padre para que la fila llegue a los
  // bordes; el padding se devuelve en el contenido, así el primero y el último
  // no quedan pegados al filo.
  avatarRow: { marginHorizontal: -24, marginBottom: 28 },
  avatarRowContent: { paddingHorizontal: 24, gap: 14, paddingVertical: 4 },
  avatarSlot: { position: 'relative' },
  check: {
    position: 'absolute', right: -3, bottom: -3,
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  checkIcon: { width: 9, height: 9 },

  inputWrap: {
    backgroundColor: colors.fillSubtle,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    height: 56, justifyContent: 'center',
  },
  input: { color: '#fff', fontSize: 16.5 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 2 },
  bannerIcon: { width: 15, height: 15 },
  errorText: { color: colors.danger, fontSize: 14, flex: 1, lineHeight: 19 },

  primaryBtn: {
    backgroundColor: '#fff', borderRadius: 28,
    paddingVertical: 17, alignItems: 'center', justifyContent: 'center',
    marginTop: 26, minHeight: 56,
  },
  primaryBtnOff: { backgroundColor: colors.border },
  primaryText: { color: '#000', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  primaryTextOff: { color: colors.textMuted },
  ghostBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  ghostText: { color: colors.textMuted, fontSize: 15 },
})
