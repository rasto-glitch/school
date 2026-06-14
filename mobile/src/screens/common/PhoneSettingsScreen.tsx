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
import { phoneOtpApi, authApi, stepUpApi, type StepUpMethod, type StepUpProof } from '../../services/api';
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
  // Re-auth password (now always required) + step-up state for changing
  // an already-verified number (migration 051).
  const [password, setPassword] = useState('');
  const [stepUpMethods, setStepUpMethods] = useState<StepUpMethod[] | null>(null);
  const [proofMethod, setProofMethod] = useState<StepUpMethod>('totp');
  const [proofCode, setProofCode] = useState('');
  const [proofSentTo, setProofSentTo] = useState<string | null>(null);
  const [proofSending, setProofSending] = useState(false);

  const needsSend = proofMethod === 'sms' || proofMethod === 'email';
  const methodLabel = (m: StepUpMethod) =>
    m === 'totp' ? t('step_up.method_totp', 'Authenticator app')
      : m === 'sms' ? t('step_up.method_sms', 'Code to my current phone')
        : t('step_up.method_email', 'Code to my email');
  const pickMethod = (m: StepUpMethod) => { setProofMethod(m); setProofCode(''); setProofSentTo(null); };

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

  const onSend = async (proof?: StepUpProof) => {
    const trimmed = phoneDraft.trim();
    if (!trimmed) {
      Alert.alert('', t('account_settings.phone_required', 'Phone number is required.'));
      return;
    }
    if (!password) {
      Alert.alert('', t('account_settings.password_required', 'Enter your current password to confirm.'));
      return;
    }
    setSubmitting(true);
    try {
      const r = await phoneOtpApi.sendVerify(trimmed, password, proof);
      setStepUpMethods(null);
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
      const data = e?.response?.data;
      // Server wants proof of an existing factor before changing the number.
      if (data?.stepUpRequired) {
        const methods: StepUpMethod[] = data.methods || [];
        setStepUpMethods(methods);
        if (methods.length) pickMethod(methods[0]);
        if (proof) {
          Alert.alert(t('common.error', 'Error'), data.error || t('step_up.verify_failed', 'Verification failed. Try again.'));
        }
        return;
      }
      Alert.alert(
        t('common.error', 'Error'),
        data?.error || t('account_settings.phone_send_failed', 'Could not send verification code.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Dispatch a step-up proof code to an existing factor (old phone / email).
  const onSendProof = async () => {
    if (!needsSend) return;
    setProofSending(true);
    try {
      const r = await stepUpApi.sendProof('change_phone', proofMethod as 'sms' | 'email');
      setProofSentTo(r.data?.sentTo || null);
      Alert.alert('✓', t('step_up.code_sent', 'Code sent to {{dest}}.', { dest: r.data?.sentTo || '' }));
    } catch (e: any) {
      Alert.alert(
        t('common.error', 'Error'),
        e?.response?.data?.error || t('step_up.send_failed', 'Could not send the code. Try another method.'),
      );
    } finally {
      setProofSending(false);
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
      setPassword('');
      setStepUpMethods(null);
      setProofCode('');
      setProofSentTo(null);
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
    setPassword('');
    setStepUpMethods(null);
    setProofCode('');
    setProofSentTo(null);
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
                onPress={() => onSend()}
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
              <Text style={styles.smallLabel}>{t('account_settings.confirm_with_password', 'Confirm with current password')}</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                autoComplete="current-password"
                textContentType="password"
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.md }}>
                <PhoneCall size={12} color={colors.textMuted} />
                <Text style={[styles.cardSub, { flex: 1 }]}>
                  {t('account_settings.phone_hint', "We'll send a verification code via WhatsApp. Only Iraqi (+964) numbers are supported right now.")}
                </Text>
              </View>

              {stepUpMethods ? (
                <View style={styles.stepUpCard}>
                  <Text style={styles.stepUpTitle}>{t('step_up.title', "Verify it's really you")}</Text>
                  <Text style={styles.cardSub}>
                    {t('step_up.subtitle', 'For your security, this change needs one more check using a method already on your account.')}
                  </Text>
                  {stepUpMethods.length > 1 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                      {stepUpMethods.map(m => (
                        <TouchableOpacity key={m} onPress={() => pickMethod(m)} style={[styles.chip, proofMethod === m && styles.chipActive]}>
                          <Text style={[styles.chipText, proofMethod === m && styles.chipTextActive]}>{methodLabel(m)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {needsSend && (
                    <TouchableOpacity
                      style={[styles.outlineBtn, { marginTop: spacing.sm }, proofSending && { opacity: 0.5 }]}
                      onPress={onSendProof}
                      disabled={proofSending}
                    >
                      {proofSending ? <ActivityIndicator color={colors.primary} /> : (
                        <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                          {proofSentTo ? t('step_up.resend', 'Resend code') : t('step_up.send', 'Send code')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {!!proofSentTo && (
                    <Text style={[styles.cardSub, { marginTop: 4 }]}>
                      {t('step_up.sent_to', 'Code sent to {{dest}}.', { dest: proofSentTo })}
                    </Text>
                  )}
                  <Text style={styles.smallLabel}>
                    {proofMethod === 'totp'
                      ? t('step_up.totp_label', 'Authenticator or recovery code')
                      : t('step_up.code_label', 'Verification code')}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.codeInput]}
                    value={proofCode}
                    onChangeText={v => setProofCode(proofMethod === 'totp' ? v.replace(/[^0-9A-Za-z-]/g, '').slice(0, 24) : v.replace(/\D/g, '').slice(0, 6))}
                    keyboardType={proofMethod === 'totp' ? 'default' : 'number-pad'}
                    placeholder="123456"
                    placeholderTextColor={colors.textMuted}
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: spacing.sm }, (submitting || !proofCode.trim() || (needsSend && !proofSentTo)) && { opacity: 0.5 }]}
                    onPress={() => onSend({ method: proofMethod, code: proofCode.trim() })}
                    disabled={submitting || !proofCode.trim() || (needsSend && !proofSentTo)}
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('step_up.verify_continue', 'Verify & continue')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.border }]} onPress={onCancel}>
                    <Text style={[styles.outlineBtnText, { color: colors.text }]}>{t('common.cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, (submitting || !phoneDraft.trim() || !password) && { opacity: 0.5 }]}
                  onPress={() => onSend()}
                  disabled={submitting || !phoneDraft.trim() || !password}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : (
                    <Text style={styles.primaryBtnText}>
                      {user?.phoneE164 && phoneDraft.trim() === user.phoneE164 && user?.phoneVerifiedAt
                        ? t('account_settings.phone_re_verify', 'Re-verify')
                        : t('account_settings.phone_send_code', 'Send code')}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
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
    // Phone numbers / codes / emails are LTR data — pin direction so they
    // don't reverse or mis-space under an RTL (ar/ku) container.
    writingDirection: 'ltr', textAlign: 'left',
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22, fontVariant: ['tabular-nums'], writingDirection: 'ltr' },
  stepUpCard: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  stepUpTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: 4 },
  chip: {
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.xs, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
});
