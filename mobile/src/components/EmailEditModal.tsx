import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, CheckCircle, Mail, ShieldCheck } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import { spacing, radius, font } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  currentEmail: string | null;
}

const RESEND_COOLDOWN_SECONDS = 30;

// Shared modal for setting / changing the user's email from Settings.
// First-time set is one shot (backend applies immediately). Changing an
// existing email is two-step: PATCH sends a 6-digit code to the new
// address, then POST /auth/me/email/verify-code applies it.

export default function EmailEditModal({ visible, onClose, currentEmail }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const setEmail = useAuthStore(s => s.setEmail);

  const [draft, setDraft] = useState(currentEmail || '');
  const [saving, setSaving] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Reset on open / when current email changes
  useEffect(() => {
    if (visible) {
      setDraft(currentEmail || '');
      setPendingEmail(null);
      setCode('');
      setResendCooldown(0);
    }
  }, [visible, currentEmail]);

  // Cooldown tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

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
      const { pending, email: applied } = r.data || {};
      if (pending) {
        // Change confirmation — switch to code-input state
        setPendingEmail(clean);
        setCode('');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        // First-time set — backend applied immediately
        setEmail(applied || clean);
        onClose();
      }
    } catch (e: any) {
      Alert.alert(
        t('settings.email_save_failed_title'),
        e?.response?.data?.error || t('settings.email_save_failed_body'),
      );
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      Alert.alert(t('settings.email_code_invalid_format'));
      return;
    }
    setVerifying(true);
    try {
      const r = await authApi.verifyEmailCode(code);
      setEmail(r.data?.email || pendingEmail || '');
      onClose();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.attemptsRemaining != null
        ? `${data.error} (${data.attemptsRemaining} ${t('settings.email_attempts_remaining')})`
        : data?.error || t('settings.email_code_verify_failed');
      Alert.alert(t('settings.email_save_failed_title'), msg);
      // If the token is dead, back out so the user can request a new code
      const low = (data?.error || '').toLowerCase();
      if (low.includes('expired') || low.includes('too many')) {
        setPendingEmail(null);
        setCode('');
      }
    } finally {
      setVerifying(false);
    }
  };

  const cancelPending = () => {
    setPendingEmail(null);
    setCode('');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={pendingEmail ? cancelPending : onClose}
    >
      <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            {pendingEmail ? (
              <ShieldCheck size={20} color={colors.primary} />
            ) : (
              <Mail size={20} color={colors.primary} />
            )}
            <Text style={styles.title}>
              {pendingEmail
                ? t('settings.email_verify_title')
                : currentEmail
                  ? t('settings.email_change_title')
                  : t('settings.email_set_title')}
            </Text>
          </View>
          <TouchableOpacity onPress={pendingEmail ? cancelPending : onClose} disabled={saving || verifying}>
            <X size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {pendingEmail ? (
          <>
            <Text style={styles.body}>
              {t('settings.email_verify_body', { email: pendingEmail })}
            </Text>
            <Text style={styles.label}>{t('settings.email_verification_code')}</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="123456"
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
            />
            <TouchableOpacity
              style={[styles.saveBtn, (verifying || code.length !== 6) && styles.saveBtnDisabled]}
              onPress={verify}
              disabled={verifying || code.length !== 6}
              activeOpacity={0.85}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <CheckCircle size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>{t('settings.email_verify_action')}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.linkBtn, (resendCooldown > 0 || saving) && styles.saveBtnDisabled]}
              onPress={save}
              disabled={resendCooldown > 0 || saving}
              activeOpacity={0.7}
            >
              <Text style={[styles.linkBtnText, { color: colors.primary }]}>
                {resendCooldown > 0
                  ? `${t('settings.email_resend_in')} ${resendCooldown}s`
                  : t('settings.email_resend_code')}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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
          </>
        )}
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
  codeInput: {
    fontSize: 24, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.md,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  linkBtn: {
    padding: spacing.sm, alignItems: 'center', marginTop: spacing.xs,
  },
  linkBtnText: { fontSize: font.sm, fontWeight: '600' },
});
