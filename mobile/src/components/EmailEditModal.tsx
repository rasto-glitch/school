import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, CheckCircle, Mail } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import { spacing, radius, font } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  currentEmail: string | null;
}

// Shared modal for setting / changing the user's email from Settings. The
// ReportBugScreen has its own copy because it needs to auto-retry the bug
// submission after saving — the two flows have different success behaviour
// and we don't want to couple them.

export default function EmailEditModal({ visible, onClose, currentEmail }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const setEmail = useAuthStore(s => s.setEmail);

  const [draft, setDraft] = useState(currentEmail || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft(currentEmail || '');
  }, [visible, currentEmail]);

  const styles = makeStyles(colors);

  const save = async () => {
    const clean = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      Alert.alert(t('settings.email_invalid'));
      return;
    }
    if (clean === (currentEmail || '').toLowerCase()) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const r = await authApi.updateMyEmail(clean);
      // Backend returns `pending: true` when the user has an existing email
      // (change requires confirmation link sent to the NEW address) or
      // `pending: false` for first-time set (applied immediately).
      const pending = (r.data as { pending?: boolean }).pending;
      if (pending) {
        Alert.alert(
          t('settings.email_pending_title'),
          t('settings.email_pending_body', { email: clean }),
        );
        // Don't update the local store; the new email isn't live until
        // the user clicks the link. Next /me fetch will reflect it.
      } else {
        setEmail(clean);
      }
      onClose();
    } catch (e: any) {
      Alert.alert(
        t('settings.email_save_failed_title'),
        e?.response?.data?.error || t('settings.email_save_failed_body'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Mail size={20} color={colors.primary} />
            <Text style={styles.title}>
              {currentEmail ? t('settings.email_change_title') : t('settings.email_set_title')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} disabled={saving}>
            <X size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.body}>
          {currentEmail
            ? t('settings.email_change_body')
            : t('settings.email_set_body')}
        </Text>

        <Text style={styles.label}>{t('settings.email_field_label')}</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          autoFocus
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <CheckCircle size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{t('settings.email_save')}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  modal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  body: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  label: {
    fontSize: font.sm, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 6, marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.md,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
