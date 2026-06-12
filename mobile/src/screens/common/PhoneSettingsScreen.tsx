import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Phone, ChevronLeft, CheckCircle, AlertTriangle, PhoneCall,
} from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { phoneOtpApi, authApi } from '../../services/api';
import { spacing, radius, font } from '../../theme';

// Phone verification — Stage B of the WhatsApp OTP feature
// (migration 050). User enters their Iraqi mobile, we send a 6-digit
// code via OTPIQ WhatsApp (with email fallback when WhatsApp delivery
// fails), and stamp users.phone_verified_at on success.
//
// Mirrors the web AccountSettingsModal's phone section. Layout and
// strings are kept aligned so QA can run the same script on both.

const RESEND_COOLDOWN_SECONDS = 30;

type Step = 'idle' | 'pending';

export default function PhoneSettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const user = useAuthStore(s => s.user);
  const setStorePhone = useAuthStore(s => s.setPhone);
  const styles = makeStyles(colors);

  const [step, setStep] = useState<Step>('idle');
  const [phoneDraft, setPhoneDraft] = useState<string>(user?.phoneE164 || '');
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown(n => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  // Pull the canonical phone state from the server on mount. Without
  // this the screen shows whatever was cached in the auth store at
  // login time, which misses admin-set phones and cross-device verifies.
  useEffect(() => {
    let cancelled = false;
    authApi.getMe()
      .then(r => {
        if (cancelled) return;
        setStorePhone(r.data.phoneE164 ?? null, r.data.phoneVerifiedAt ?? null);
        if (r.data.phoneE164 && !phoneDraft) setPhoneDraft(r.data.phoneE164);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
    // intentionally only on mount — re-syncs aren't required after the
    // user starts editing the field
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSend = async () => {
    const trimmed = phoneDraft.trim();
    if (!trimmed) {
      Alert.alert('', t('account_settings.phone_required', 'Phone number is required.'));
      return;
    }
    setSubmitting(true);
    try {
      const r = await phoneOtpApi.sendVerify(trimmed);
      setPendingPhone(trimmed);
      setStep('pending');
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      if (r.data?.deliveryAttempted?.whatsapp) {
        Alert.alert('✓', t('account_settings.phone_code_sent_whatsapp', 'Verification code sent via WhatsApp.'));
      } else if (r.data?.deliveryAttempted?.emailFallbackImmediate) {
        Alert.alert('', t('account_settings.phone_code_sent_email', 'WhatsApp delivery is unavailable; we emailed you the code instead.'));
      }
    } catch (e: any) {
      Alert.alert(
        t('common.error', 'Error'),
        e?.response?.data?.error || t('account_settings.phone_send_failed', 'Could not send verification code.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      Alert.alert('', t('account_settings.code_invalid_format', 'Enter the 6-digit code.'));
      return;
    }
    setVerifying(true);
    try {
      const r = await phoneOtpApi.confirmVerify(code);
      const verifiedAt = r.data?.verifiedAt || new Date().toISOString();
      setStorePhone(pendingPhone || phoneDraft, verifiedAt);
      setStep('idle');
      setPendingPhone(null);
      setCode('');
      Alert.alert('✓', t('account_settings.phone_verified', 'Phone verified.'));
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('account_settings.phone_verify_failed', 'Could not verify code.');
      Alert.alert(t('common.error', 'Error'), msg);
      if (typeof msg === 'string' && (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('too many'))) {
        setStep('idle');
        setPendingPhone(null);
        setCode('');
      }
    } finally {
      setVerifying(false);
    }
  };

  const onCancel = () => {
    setStep('idle');
    setPendingPhone(null);
    setCode('');
    setPhoneDraft(user?.phoneE164 || '');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('account_settings.phone_section', 'Phone number')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}>
          {user?.phoneE164 && user?.phoneVerifiedAt ? (
            <View style={[styles.card, { borderColor: '#10B981', borderWidth: 1 }]}>
              <CheckCircle size={22} color="#10B981" />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardText}>
                  {t('account_settings.phone_verified_summary', 'Your phone number is verified.')}
                </Text>
                <Text style={styles.cardSub}>{user.phoneE164}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <AlertTriangle size={22} color={colors.warning} />
              <Text style={styles.cardText}>
                {t('account_settings.phone_unverified_summary', 'Add a phone number so we can reach you with codes when needed. WhatsApp is preferred; email is used if WhatsApp delivery fails.')}
              </Text>
            </View>
          )}

          {step === 'pending' ? (
            <>
              <View style={[styles.card, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1 }]}>
                <Phone size={20} color="#92400E" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardText, { color: '#92400E' }]}>
                    {t('account_settings.phone_code_sent_to', 'We sent a 6-digit code to')}{' '}
                    <Text style={{ fontWeight: '700' }}>{pendingPhone}</Text>.
                  </Text>
                  <Text style={[styles.cardSub, { color: '#92400E' }]}>
                    {t('account_settings.phone_code_expires_in', 'It expires in 5 minutes.')}
                  </Text>
                </View>
              </View>

              <Text style={styles.smallLabel}>{t('account_settings.verification_code', 'Verification code')}</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
              />

              <TouchableOpacity
                style={[styles.primaryBtn, (verifying || code.length !== 6) && { opacity: 0.5 }]}
                onPress={onVerify}
                disabled={verifying || code.length !== 6}
              >
                {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('account_settings.verify', 'Verify')}</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.outlineBtn, (resendCooldown > 0 || submitting) && { opacity: 0.5 }]}
                onPress={onSend}
                disabled={resendCooldown > 0 || submitting}
              >
                {submitting ? <ActivityIndicator color={colors.primary} /> : (
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                    {resendCooldown > 0
                      ? `${t('account_settings.resend_in', 'Resend in')} ${resendCooldown}s`
                      : t('account_settings.resend_code', 'Resend code')}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.border }]} onPress={onCancel}>
                <Text style={[styles.outlineBtnText, { color: colors.text }]}>{t('common.cancel', 'Cancel')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.smallLabel}>{t('account_settings.phone_label', 'Iraqi mobile (+964)')}</Text>
              <TextInput
                style={styles.input}
                value={phoneDraft}
                onChangeText={setPhoneDraft}
                keyboardType="phone-pad"
                placeholder="0750 123 4567"
                placeholderTextColor={colors.textMuted}
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.md }}>
                <PhoneCall size={12} color={colors.textMuted} />
                <Text style={[styles.cardSub, { flex: 1 }]}>
                  {t('account_settings.phone_hint', "We'll send a verification code via WhatsApp. Only Iraqi (+964) numbers are supported right now.")}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, (submitting || !phoneDraft.trim()) && { opacity: 0.5 }]}
                onPress={onSend}
                disabled={submitting || !phoneDraft.trim()}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryBtnText}>
                    {user?.phoneE164 && phoneDraft.trim() === user.phoneE164 && user?.phoneVerifiedAt
                      ? t('account_settings.phone_re_verify', 'Re-verify')
                      : t('account_settings.phone_send_code', 'Send code')}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },
  cardSub: { fontSize: font.xs, color: colors.textSecondary, lineHeight: 16, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginBottom: spacing.sm },
  primaryBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    marginBottom: spacing.sm,
  },
  outlineBtnText: { fontSize: font.sm, fontWeight: '600' },
  smallLabel: { fontSize: font.xs, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22, fontVariant: ['tabular-nums'] },
});
