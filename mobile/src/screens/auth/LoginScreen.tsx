import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { getTrustedDeviceToken, setTrustedDeviceToken, clearTrustedDeviceToken } from '../../utils/trustedDevice';
import MfaEnrollPanel, { type MfaEnrollSuccessForced } from '../../components/MfaEnrollPanel';
import PreLoginLanguageSwitcher from '../../components/PreLoginLanguageSwitcher';
import { colors, spacing, radius, font, shadow } from '../../theme';

const MOBILE_ROLES = ['parent', 'teacher', 'driver', 'supervisor'];

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // MFA step. Phase 2 makes teacher + supervisor eligible too, so this
  // path can land for real mobile users now (admin + accountant are
  // still web-only; the finalizeLogin role check filters them out).
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [mfaUsername, setMfaUsername] = useState<string | null>(null);
  // Phase 2 forced enrollment
  const [enrollTicket, setEnrollTicket] = useState<string | null>(null);
  const [enrollUsername, setEnrollUsername] = useState<string | null>(null);

  const finalizeLogin = async (data: { token: string; refreshToken: string; user: any; school: any; trustedDeviceToken?: string }, usernameForToken?: string) => {
    if (!MOBILE_ROLES.includes(data.user?.role)) {
      Alert.alert(t('auth.role_blocked_title'), t('auth.role_blocked_body'));
      return;
    }
    if (data.trustedDeviceToken && usernameForToken) {
      await setTrustedDeviceToken(usernameForToken, data.trustedDeviceToken);
    }
    setAuth(data.token, data.refreshToken, data.user, data.school);
  };

  const handleLogin = async () => {
    if (!username || !password) { Alert.alert('', t('auth.enter_credentials')); return; }
    setLoading(true);
    try {
      const trustedToken = await getTrustedDeviceToken(username);
      const res = await authApi.login(username, password, trustedToken);
      if (res.data?.mfaRequired && res.data?.mfaTicket) {
        setMfaTicket(res.data.mfaTicket);
        setMfaUsername(username);
        setRememberDevice(false);
        setMfaCode('');
        return;
      }
      if (res.data?.mfaEnrollmentRequired && res.data?.enrollmentTicket) {
        setEnrollTicket(res.data.enrollmentTicket);
        setEnrollUsername(username);
        setRememberDevice(false);
        return;
      }
      await finalizeLogin(res.data, username);
    } catch (err: any) {
      const serverMsg = err.response?.data?.error;
      const msg = serverMsg
        ? serverMsg
        : err.response
          ? t('auth.invalid_credentials')
          : t('auth.network_error');
      Alert.alert(t('auth.sign_in_failed'), msg);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async () => {
    if (!mfaTicket) return;
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      Alert.alert('', t('auth.mfa_code_required'));
      return;
    }
    setMfaVerifying(true);
    try {
      const res = await authApi.verifyMfaLogin(mfaTicket, trimmed, rememberDevice);
      await finalizeLogin(res.data, mfaUsername || username);
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || t('auth.mfa_failed');
      Alert.alert(t('auth.sign_in_failed'), msg);
      if (status === 401 && msg && /sign in again/i.test(msg)) {
        setMfaTicket(null);
        setMfaCode('');
        if (mfaUsername) await clearTrustedDeviceToken(mfaUsername);
      }
    } finally {
      setMfaVerifying(false);
    }
  };

  const cancelMfa = () => {
    setMfaTicket(null);
    setMfaCode('');
    setMfaUsername(null);
    setRememberDevice(false);
  };

  const onEnrollSuccess = async (payload: MfaEnrollSuccessForced) => {
    await finalizeLogin(payload, enrollUsername || username);
    setEnrollTicket(null);
    setEnrollUsername(null);
  };

  const onEnrollCancel = () => {
    setEnrollTicket(null);
    setEnrollUsername(null);
    setRememberDevice(false);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PreLoginLanguageSwitcher />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image source={require('../../../assets/logo.png')} style={styles.logoImg} resizeMode="contain" />
          <Text style={styles.brandTitle}>Scholify</Text>
          <Text style={styles.brandSub}>{t('auth.subtitle')}</Text>
        </View>

        <View style={styles.card}>
          {enrollTicket ? (
            <MfaEnrollPanel
              mode="forced"
              enrollmentTicket={enrollTicket}
              rememberDevice={rememberDevice}
              onRememberDeviceChange={setRememberDevice}
              onSuccess={onEnrollSuccess}
              onCancel={onEnrollCancel}
            />
          ) : mfaTicket ? (
            <>
              <Text style={styles.mfaTitle}>{t('auth.mfa_title')}</Text>
              <Text style={styles.mfaSub}>{t('auth.mfa_subtitle')}</Text>

              <Text style={styles.label}>{t('auth.mfa_code_label')}</Text>
              <TextInput
                style={[styles.input, styles.mfaCodeInput]}
                value={mfaCode}
                onChangeText={v => setMfaCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                maxLength={6}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                returnKeyType="done"
                onSubmitEditing={handleMfaVerify}
              />

              <TouchableOpacity
                onPress={() => setRememberDevice(!rememberDevice)}
                style={styles.checkboxRow}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, rememberDevice && { backgroundColor: colors.primary, borderColor: colors.primary }]} />
                <Text style={styles.checkboxLabel}>{t('auth.remember_device_30d')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, (mfaVerifying || mfaCode.length !== 6) && { opacity: 0.6 }]}
                onPress={handleMfaVerify}
                disabled={mfaVerifying || mfaCode.length !== 6}
              >
                {mfaVerifying
                  ? <ActivityIndicator color={colors.textInverse} />
                  : <Text style={styles.btnText}>{t('auth.mfa_verify_action')}</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={cancelMfa} style={styles.forgotWrap}>
                <Text style={styles.forgotLink}>{t('auth.mfa_back')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t('auth.username')}</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('auth.username_ph')}
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
              />

              <Text style={styles.label}>{t('auth.password')}</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={t('auth.password_ph')}
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />

              <TouchableOpacity style={[styles.btn, loading && { opacity: 0.7 }]} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.btnText}>{t('auth.sign_in')}</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => navigation.navigate('ForgotPassword', { prefillUsername: username })}
                style={styles.forgotWrap}
              >
                <Text style={styles.forgotLink}>{t('auth.forgot_password')}</Text>
              </TouchableOpacity>

              <Text style={styles.hint}>{t('auth.contact_admin')}</Text>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoImg: { width: 80, height: 80, borderRadius: 18, marginBottom: spacing.md },
  brandTitle: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  brandSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, ...shadow.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: font.md, color: colors.text, marginBottom: spacing.md, backgroundColor: colors.bg },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: colors.textInverse, fontSize: font.md, fontWeight: '700' },
  forgotWrap: { alignItems: 'center', marginTop: spacing.md },
  forgotLink: { fontSize: font.sm, fontWeight: '600', color: '#2563EB' },
  hint: { fontSize: font.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  mfaTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: 4 },
  mfaSub: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  mfaCodeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 24, fontVariant: ['tabular-nums'] },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xs },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border },
  checkboxLabel: { fontSize: font.sm, color: colors.text },
});
