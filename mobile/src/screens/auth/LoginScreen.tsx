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
import { colors, spacing, radius, font, shadow } from '../../theme';

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { Alert.alert('', t('auth.enter_credentials')); return; }
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      const MOBILE_ROLES = ['parent', 'teacher', 'driver', 'supervisor'];
      if (!MOBILE_ROLES.includes(res.data.user?.role)) {
        Alert.alert(t('auth.role_blocked_title'), t('auth.role_blocked_body'));
        return;
      }
      setAuth(res.data.token, res.data.refreshToken, res.data.user, res.data.school);
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
});
