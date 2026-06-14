import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { mfaFactorsApi, type FactorStatus } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';

// "Use at sign-in" control for a phone/email login factor (Phase 3). Mirrors the
// web LoginFactorToggle: the backend requires current password + a code to the
// channel to arm or disarm it. Rendered under the matching method row in the
// Security hub, reachable by every role.
type Props = {
  factor: 'phone' | 'email';
  status: FactorStatus;          // available / armed / preferred for this factor
  canEnable: boolean;            // email-not-solo precondition satisfied
  multipleArmed: boolean;        // is "make default" meaningful?
  onChanged: (factors: FactorStatus[]) => void;
};

export default function LoginFactorToggle({ factor, status, canEnable, multipleArmed, onChanged }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const [mode, setMode] = useState<'idle' | 'enable' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<'whatsapp' | 'email' | null>(null);

  const reset = () => { setMode('idle'); setPassword(''); setCode(''); setCodeSent(false); setChannel(null); };

  const sendCode = async () => {
    setSending(true);
    try {
      const res = await mfaFactorsApi.sendCode(factor);
      setChannel(res.data?.channel ?? (factor === 'phone' ? 'whatsapp' : 'email'));
      setCodeSent(true);
    } catch (err: any) {
      Alert.alert('', err.response?.data?.error || t('login_factors.send_failed', 'Could not send a code.'));
    } finally { setSending(false); }
  };

  const submit = async () => {
    if (!password || !/^\d{6}$/.test(code)) {
      Alert.alert('', t('login_factors.need_password_code', 'Enter your password and the 6-digit code.'));
      return;
    }
    setBusy(true);
    try {
      const res = mode === 'enable'
        ? await mfaFactorsApi.enable(factor, password, code)
        : await mfaFactorsApi.disable(factor, password, code);
      onChanged(res.data.factors);
      reset();
    } catch (err: any) {
      Alert.alert('', err.response?.data?.error || t('login_factors.failed', 'Could not update. Try again.'));
    } finally { setBusy(false); }
  };

  const makeDefault = async () => {
    try {
      const res = await mfaFactorsApi.setPreferred(factor);
      onChanged(res.data.factors);
    } catch (err: any) {
      Alert.alert('', err.response?.data?.error || t('login_factors.failed', 'Could not update. Try again.'));
    }
  };

  if (!status.available) {
    return (
      <Text style={s.unavailable}>
        {factor === 'phone'
          ? t('login_factors.unavailable_phone', 'Verify your phone to use it for sign-in.')
          : t('login_factors.unavailable_email', 'Add an email to use it for sign-in.')}
      </Text>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <View style={s.labelRow}>
            <Text style={s.label}>{t('login_factors.use_at_signin', 'Use at sign-in')}</Text>
            {status.armed && status.preferred && (
              <View style={s.defaultPill}><Text style={s.defaultPillText}>{t('login_factors.default', 'Default')}</Text></View>
            )}
          </View>
          <Text style={s.hint}>
            {status.armed
              ? t('login_factors.on_hint', 'A code is required here when you sign in.')
              : t('login_factors.off_hint', 'Turn on to require a code at sign-in.')}
          </Text>
        </View>
        {mode === 'idle' && (
          status.armed ? (
            <TouchableOpacity onPress={() => setMode('disable')}><Text style={s.turnOff}>{t('login_factors.turn_off', 'Turn off')}</Text></TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => { if (!canEnable) { Alert.alert('', t('login_factors.email_needs_partner', 'Add phone or an authenticator first — email can’t be your only sign-in code.')); return; } setMode('enable'); }}>
              <Text style={s.turnOn}>{t('login_factors.turn_on', 'Turn on')}</Text>
            </TouchableOpacity>
          )
        )}
      </View>

      {status.armed && !status.preferred && multipleArmed && mode === 'idle' && (
        <TouchableOpacity onPress={makeDefault} style={{ marginTop: spacing.xs }}>
          <Text style={s.makeDefault}>{t('login_factors.make_default', 'Make default')}</Text>
        </TouchableOpacity>
      )}

      {mode !== 'idle' && (
        <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={t('account_settings.confirm_with_password', 'Confirm with current password')}
            placeholderTextColor={colors.textMuted}
            autoComplete="current-password"
          />
          {!codeSent ? (
            <TouchableOpacity style={[s.btn, (!password || sending) && { opacity: 0.6 }]} onPress={sendCode} disabled={!password || sending}>
              {sending ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.btnText}>{t('login_factors.send_code', 'Send code')}</Text>}
            </TouchableOpacity>
          ) : (
            <>
              <Text style={s.sentNote}>
                {channel === 'whatsapp' ? t('auth.login_otp_sent_whatsapp', 'We sent a code via WhatsApp.') : t('auth.login_otp_sent_email', 'We sent a code to your email.')}
              </Text>
              <TextInput
                style={[s.input, s.codeInput]}
                value={code}
                onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                maxLength={6}
              />
              <View style={s.actions}>
                <TouchableOpacity onPress={reset} style={{ paddingVertical: 8, paddingHorizontal: 12 }}><Text style={s.cancel}>{t('common.cancel', 'Cancel')}</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, s.btnInline, mode === 'disable' && s.btnDanger, (!password || code.length !== 6 || busy) && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={!password || code.length !== 6 || busy}
                >
                  {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.btnText}>{mode === 'enable' ? t('login_factors.confirm_on', 'Turn on') : t('login_factors.confirm_off', 'Turn off')}</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.xs, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  hint: { fontSize: font.xs, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  turnOn: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  turnOff: { fontSize: font.sm, fontWeight: '700', color: colors.danger },
  makeDefault: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  defaultPill: { backgroundColor: '#EEF2FF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  defaultPillText: { fontSize: 10, fontWeight: '800', color: '#4F46E5' },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: font.md, color: colors.text, backgroundColor: colors.bg },
  codeInput: { textAlign: 'center', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  btnInline: { paddingHorizontal: spacing.lg },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: colors.textInverse, fontSize: font.sm, fontWeight: '700' },
  sentNote: { fontSize: font.xs, color: colors.textSecondary },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  cancel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  unavailable: { fontSize: font.xs, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm, marginLeft: 4 },
});
