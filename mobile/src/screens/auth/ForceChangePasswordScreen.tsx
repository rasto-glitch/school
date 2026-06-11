import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react-native';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import PreLoginLanguageSwitcher from '../../components/PreLoginLanguageSwitcher';
import { colors, spacing, radius, font, shadow } from '../../theme';

// Force-change-password screen. The navigator (navigation/index.tsx) routes
// here automatically when `authed && user.mustChangePassword`. Until the
// user submits a new password, no other authenticated screen is reachable.
// The pre-login language switcher is rendered so a parent who only reads
// Kurdish or Arabic can flip the UI and understand WHY the dashboards
// aren't appearing — otherwise the trapped state looks like a broken login.
export default function ForceChangePasswordScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, token, refreshToken, school, setAuth, logout } = useAuthStore();

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!newPassword || !confirm) {
      Alert.alert('', t('force_change.both_required'));
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert('', t('profile.passwords_no_match'));
      return;
    }
    if (!isStrongPassword(newPassword)) {
      Alert.alert('', PASSWORD_POLICY_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.firstTimeChangePassword(newPassword);
      // Clear the locally-cached flag so the navigator swaps out the
      // force-change stack on the next render. We rebuild the auth tuple
      // with the same tokens / school — only the user changes.
      if (user && token && refreshToken && school) {
        setAuth(token, refreshToken, { ...user, mustChangePassword: false }, school);
      }
    } catch (err: any) {
      Alert.alert(t('common.failed'), err.response?.data?.error || t('force_change.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PreLoginLanguageSwitcher />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.iconWrap}>
              <ShieldAlert size={20} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('force_change.title')}</Text>
              <Text style={styles.subtitle}>{t('force_change.subtitle')}</Text>
            </View>
          </View>

          <Text style={styles.body}>{t('force_change.body')}</Text>

          <Text style={styles.label}>{t('force_change.new_password')}</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholderTextColor={colors.textMuted}
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="next"
          />

          <Text style={styles.label}>{t('force_change.confirm')}</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholderTextColor={colors.textMuted}
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />

          <Text style={styles.hint}>{t('force_change.policy_hint')}</Text>

          <TouchableOpacity
            style={[styles.btn, submitting && { opacity: 0.6 }]}
            onPress={onSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color={colors.textInverse} />
              : <Text style={styles.btnText}>{t('force_change.submit')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => logout()} style={styles.signOutWrap}>
            <Text style={styles.signOutLink}>{t('force_change.sign_out')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, ...shadow.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF3C7' },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  body: { fontSize: font.sm, color: colors.text, lineHeight: 20, marginBottom: spacing.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: font.md, color: colors.text, marginBottom: spacing.md, backgroundColor: colors.bg },
  hint: { fontSize: font.xs, color: colors.textMuted, marginBottom: spacing.md },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: colors.textInverse, fontSize: font.md, fontWeight: '700' },
  signOutWrap: { alignItems: 'center', marginTop: spacing.md },
  signOutLink: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, textDecorationLine: 'underline' },
});
