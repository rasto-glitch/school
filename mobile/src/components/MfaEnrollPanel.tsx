import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, StyleSheet,
  ActivityIndicator, Alert, Linking, ScrollView, Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ShieldCheck, ExternalLink, X, Share2 } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { authApi, mfaApi } from '../services/api';
import { spacing, radius, font } from '../theme';

// Reusable MFA enrollment UI used by:
//   - LoginScreen forced-enrollment flow (ticket-based, returns tokens on confirm)
//   - SettingsScreen authenticated enrollment (no ticket, uses mfaApi)
//
// The `mode` prop discriminates: in 'forced' mode we expect a ticket and
// the confirm step returns full login state (tokens + user + school); in
// 'authenticated' mode the user is already signed in and we just flip
// the MFA active flag.

export type MfaEnrollMode = 'forced' | 'authenticated';

export interface MfaEnrollSuccessForced {
  token: string;
  refreshToken: string;
  user: any;
  school: any;
  trustedDeviceToken?: string;
}

interface BaseProps {
  rememberDevice: boolean;
  onRememberDeviceChange: (next: boolean) => void;
  onCancel: () => void;
}

interface ForcedProps extends BaseProps {
  mode: 'forced';
  enrollmentTicket: string;
  onSuccess: (result: MfaEnrollSuccessForced) => void;
}

interface AuthenticatedProps extends BaseProps {
  mode: 'authenticated';
  onSuccess: () => void;
}

type Props = ForcedProps | AuthenticatedProps;

interface SetupData { qrDataUrl: string; secret: string; otpauthUri: string; recoveryCodes: string[]; }

type Step = 'scan' | 'recovery';

export default function MfaEnrollPanel(props: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [data, setData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<Step>('scan');
  const [ack, setAck] = useState(false);
  const [openingApp, setOpeningApp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      setLoading(true);
      try {
        const res = props.mode === 'forced'
          ? await authApi.enrollMfaSetup(props.enrollmentTicket)
          : await mfaApi.setup();
        if (!cancelled) setData(res.data);
      } catch (e: any) {
        if (!cancelled) {
          Alert.alert(t('auth.sign_in_failed'), e?.response?.data?.error || t('mfa.setup_failed'));
          props.onCancel();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void start();
    return () => { cancelled = true; };
    // We intentionally exclude `props` from deps — this is mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openInAuthenticator = async () => {
    if (!data) return;
    setOpeningApp(true);
    try {
      const supported = await Linking.canOpenURL(data.otpauthUri);
      if (supported) {
        await Linking.openURL(data.otpauthUri);
      } else {
        Alert.alert(t('mfa.no_authenticator_title'), t('mfa.no_authenticator_body'));
      }
    } catch {
      Alert.alert(t('mfa.no_authenticator_title'), t('mfa.no_authenticator_body'));
    } finally {
      setOpeningApp(false);
    }
  };

  const onConfirm = async () => {
    if (!/^\d{6}$/.test(code)) {
      Alert.alert(t('mfa.code_invalid_format'));
      return;
    }
    setConfirming(true);
    try {
      if (props.mode === 'forced') {
        const res = await authApi.enrollMfaConfirm(props.enrollmentTicket, code, props.rememberDevice);
        // Move to recovery step in-place AFTER successful verify so the
        // user sees recovery codes before they're routed away.
        setStep('recovery');
        // Stash the success payload via a ref-like state so the user
        // sees codes first; we trigger onSuccess only when they ack.
        (pendingSuccessRef as any).current = res.data;
      } else {
        await mfaApi.confirm(code);
        setStep('recovery');
      }
    } catch (e: any) {
      Alert.alert(t('auth.sign_in_failed'), e?.response?.data?.error || t('mfa.confirm_failed'));
    } finally {
      setConfirming(false);
    }
  };

  const finish = () => {
    if (props.mode === 'forced') {
      const payload = (pendingSuccessRef as any).current as MfaEnrollSuccessForced | undefined;
      if (payload) props.onSuccess(payload);
    } else {
      props.onSuccess();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('auth.mfa_enroll_title')}</Text>
          <Text style={styles.sub}>
            {props.mode === 'forced' ? t('auth.mfa_enroll_subtitle') : t('mfa.scan_instructions')}
          </Text>
        </View>
        <TouchableOpacity onPress={props.onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {loading || !data ? (
        <View style={styles.spinnerBox}><ActivityIndicator color={colors.primary} /></View>
      ) : step === 'scan' ? (
        <>
          <View style={styles.qrBox}>
            <Image source={{ uri: data.qrDataUrl }} style={{ width: 200, height: 200, borderRadius: radius.md }} />
          </View>

          <TouchableOpacity onPress={openInAuthenticator} style={styles.openBtn} disabled={openingApp}>
            {openingApp
              ? <ActivityIndicator color={colors.primary} />
              : (
                <>
                  <ExternalLink size={16} color={colors.primary} />
                  <Text style={[styles.openBtnText, { color: colors.primary }]}>
                    {t('mfa.open_in_authenticator')}
                  </Text>
                </>
              )}
          </TouchableOpacity>

          <Text style={styles.smallLabel}>{t('mfa.manual_key_label')}</Text>
          <Text selectable style={styles.secretBox}>{data.secret}</Text>

          <Text style={styles.smallLabel}>{t('mfa.code_label')}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="done"
            onSubmitEditing={onConfirm}
          />

          <TouchableOpacity
            style={[styles.primaryBtn, (confirming || code.length !== 6) && { opacity: 0.5 }]}
            onPress={onConfirm}
            disabled={confirming || code.length !== 6}
          >
            {confirming
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>{t('mfa.confirm_action')}</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>{t('mfa.recovery_save_title')}</Text>
            <Text style={styles.warnBody}>{t('mfa.recovery_save_body')}</Text>
          </View>
          <View style={styles.codesGrid}>
            {data.recoveryCodes.map((c, i) => (
              <Text key={i} selectable style={styles.codeItem}>{c}</Text>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => shareRecoveryCodes(data.recoveryCodes, t)}
            style={styles.shareBtn}
          >
            <Share2 size={16} color={colors.primary} />
            <Text style={[styles.shareBtnText, { color: colors.primary }]}>
              {t('mfa.share_codes')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAck(!ack)} style={styles.ackRow}>
            <View style={[styles.checkbox, ack && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {ack && <CheckCircle size={14} color="#fff" />}
            </View>
            <Text style={styles.ackLabel}>{t('mfa.recovery_ack')}</Text>
          </TouchableOpacity>

          {props.mode === 'forced' && (
            <TouchableOpacity onPress={() => props.onRememberDeviceChange(!props.rememberDevice)} style={styles.ackRow}>
              <View style={[styles.checkbox, props.rememberDevice && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                {props.rememberDevice && <CheckCircle size={14} color="#fff" />}
              </View>
              <Text style={styles.ackLabel}>{t('auth.remember_device_30d')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, !ack && { opacity: 0.5 }]}
            onPress={finish}
            disabled={!ack}
          >
            <Text style={styles.primaryBtnText}>{t('mfa.finish_action')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// React's `useRef` is fine but using a module-scope mutable here is
// simpler than ref-typing for a one-shot success payload. Safe because
// MfaEnrollPanel is mounted at most once per flow.
const pendingSuccessRef: { current?: MfaEnrollSuccessForced } = {};

// Built-in Share API — no extra dep. Opens the system share sheet so
// the user can pick Mail, Messages, Notes, Files (iOS), Drive, etc.
async function shareRecoveryCodes(codes: string[], t: (k: string) => string): Promise<void> {
  const header = [
    'Scholify two-factor recovery codes',
    `Saved: ${new Date().toISOString()}`,
    '',
    'Each code works ONCE. Use one in place of the 6-digit code at sign-in if you lose your authenticator.',
    '',
  ].join('\n');
  try {
    await Share.share({
      message: header + codes.join('\n'),
      title: t('mfa.recovery_save_title'),
    });
  } catch { /* user dismissed */ }
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  spinnerBox: { paddingVertical: 40, alignItems: 'center' },
  qrBox: { alignItems: 'center', padding: spacing.sm, backgroundColor: '#fff', borderRadius: radius.md, alignSelf: 'center' },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    marginTop: spacing.sm,
  },
  openBtnText: { fontSize: font.sm, fontWeight: '600' },
  smallLabel: { fontSize: font.xs, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  secretBox: {
    fontFamily: 'monospace', fontSize: font.sm, color: colors.text,
    backgroundColor: colors.card, padding: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 24, fontVariant: ['tabular-nums'] },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.md,
  },
  primaryBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  warnBox: { backgroundColor: '#FFFBEB', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#FCD34D' },
  warnTitle: { fontSize: font.sm, fontWeight: '700', color: '#92400E' },
  warnBody: { fontSize: font.xs, color: '#92400E', marginTop: 4, lineHeight: 16 },
  codesGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  codeItem: { fontFamily: 'monospace', fontSize: font.sm, color: colors.text, width: '47%' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    marginTop: spacing.sm,
  },
  shareBtnText: { fontSize: font.sm, fontWeight: '600' },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  ackLabel: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },
});
