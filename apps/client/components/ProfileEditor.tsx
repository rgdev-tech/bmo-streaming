import { useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SymbolView } from 'expo-symbols'
import { AVATARS } from '@/lib/avatars'
import { ProfileAvatar } from './ProfileAvatar'
import { Touchable } from './Touchable'
import type { Profile } from '@/lib/supabase'
import { colors } from '@/lib/theme'

// Detalle de perfil, con el patrón de las pantallas de Ajustes de iOS: cabecera
// con el elemento en grande, listas agrupadas en tarjetas con separadores
// finos, encabezados en mayúsculas, y la acción destructiva sola al final en
// rojo. Antes el modo edición iba directo a borrar — no había forma de cambiar
// el nombre ni el icono.
export function ProfileEditor({
  profile, onSave, onManagePin, onDelete, onClose,
  canDelete, insets,
}: {
  profile: Profile
  onSave: (patch: { name?: string; avatar?: string }) => Promise<boolean>
  onManagePin: () => void
  onDelete: () => void
  onClose: () => void
  canDelete: boolean
  insets: { top: number; bottom: number }
}) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = name.trim() !== profile.name || avatar !== profile.avatar
  const canSave = dirty && name.trim().length > 0 && !busy

  async function save() {
    if (!canSave) return
    setBusy(true); setError(null)
    const ok = await onSave({ name: name.trim(), avatar })
    setBusy(false)
    if (!ok) { setError('No se pudo guardar. ¿Ya usas ese nombre?'); return }
    onClose()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      {/* Barra superior fija: cerrar a la izquierda, guardar a la derecha.
          El guardar solo se habilita si algo cambió. */}
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Touchable style={styles.barBtn} scaleTo={0.94} haptic="light" onPress={onClose} hitSlop={8}>
          <Text style={styles.barCancel}>Cancelar</Text>
        </Touchable>
        <Text style={styles.barTitle}>Perfil</Text>
        <Touchable
          style={styles.barBtn}
          scaleTo={0.94}
          haptic="medium"
          onPress={save}
          disabled={!canSave}
        >
          {busy
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={[styles.barSave, !canSave && styles.barSaveOff]}>Guardar</Text>}
        </Touchable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <ProfileAvatar avatar={avatar} size={104} />
        </View>

        <Text style={styles.sectionLabel}>Icono</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.avatarRow}
          contentContainerStyle={styles.avatarRowContent}
        >
          {AVATARS.map((a) => (
            <Touchable key={a.key} scaleTo={0.88} haptic="selection" onPress={() => setAvatar(a.key)}>
              <View>
                <ProfileAvatar avatar={a.key} size={60} selected={a.key === avatar} />
                {a.key === avatar && (
                  <View style={styles.check}>
                    <SymbolView name="checkmark" tintColor="#000" style={styles.checkIcon} />
                  </View>
                )}
              </View>
            </Touchable>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Nombre</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <TextInput
              style={styles.rowInput}
              value={name}
              onChangeText={(v) => { setName(v); if (error) setError(null) }}
              placeholder="Nombre"
              placeholderTextColor="rgba(255,255,255,0.3)"
              maxLength={30}
              selectionColor="#fff"
              returnKeyType="done"
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>Seguridad</Text>
        <View style={styles.group}>
          <Touchable style={styles.row} scaleTo={0.99} haptic="light" onPress={onManagePin}>
            <SymbolView
              name={profile.has_pin ? 'lock.fill' : 'lock.open.fill'}
              tintColor={profile.has_pin ? '#fff' : 'rgba(255,255,255,0.45)'}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>Bloqueo con PIN</Text>
            <Text style={styles.rowValue}>{profile.has_pin ? 'Activado' : 'Desactivado'}</Text>
            <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.28)" style={styles.chevron} />
          </Touchable>
        </View>

        {!!error && (
          <View style={styles.banner}>
            <SymbolView name="exclamationmark.circle.fill" tintColor={colors.danger} style={styles.bannerIcon} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Grupo aparte y en rojo: separarlo del resto evita el toque por
            error, que es lo que importa en una acción irreversible. */}
        {canDelete && (
          <View style={[styles.group, styles.groupDanger]}>
            <Touchable style={styles.row} scaleTo={0.99} haptic="medium" onPress={onDelete}>
              <SymbolView name="trash.fill" tintColor={colors.danger} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, styles.dangerLabel]}>Eliminar perfil</Text>
            </Touchable>
          </View>
        )}
        {!canDelete && (
          <Text style={styles.hint}>
            No puedes eliminar tu único perfil. Crea otro antes.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 12,
  },
  barBtn: { minWidth: 74, paddingVertical: 6 },
  barTitle: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  barCancel: { color: colors.textDim, fontSize: 16 },
  barSave: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  barSaveOff: { color: colors.textFaint, fontWeight: '600' },

  content: { paddingHorizontal: 20 },
  hero: { alignItems: 'center', paddingVertical: 26 },

  sectionLabel: {
    color: colors.textMuted, fontSize: 12.5, fontWeight: '700',
    letterSpacing: 0.7, textTransform: 'uppercase',
    marginBottom: 11, marginLeft: 4, marginTop: 8,
  },
  avatarRow: { marginHorizontal: -20, marginBottom: 26 },
  avatarRowContent: { paddingHorizontal: 20, gap: 14, paddingVertical: 4 },
  check: {
    position: 'absolute', right: -2, bottom: -2,
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  checkIcon: { width: 9, height: 9 },

  // Tarjeta agrupada: el patrón de Ajustes.
  group: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.11)',
    overflow: 'hidden',
    marginBottom: 26,
  },
  groupDanger: { marginTop: 14, borderColor: 'rgba(255,107,107,0.22)' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 12, minHeight: 54,
  },
  rowIcon: { width: 17, height: 17 },
  rowLabel: { color: '#fff', fontSize: 16, flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: 15.5 },
  rowInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 16 },
  chevron: { width: 12, height: 12 },
  dangerLabel: { color: colors.danger, fontWeight: '600' },

  hint: {
    color: 'rgba(255,255,255,0.35)', fontSize: 13.5,
    textAlign: 'center', marginTop: 6, lineHeight: 19, paddingHorizontal: 20,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16, paddingHorizontal: 2 },
  bannerIcon: { width: 15, height: 15 },
  errorText: { color: colors.danger, fontSize: 14, flex: 1, lineHeight: 19 },
})
