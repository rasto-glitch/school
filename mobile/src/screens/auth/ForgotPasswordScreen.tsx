import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ArrowLeft, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react-native';
import { authApi } from '../../services/api';
import { colors, spacing, radius, font, shadow } from '../../theme';

// Reached from LoginScreen's "Forgot password?" link. The user enters their
// username and picks one of two reset methods:
//   1. Email link — only useful if they have an email on file; we always
//      return success either way so this can't be used to enumerate which
//      users have email addresses.
//   2. Admin reset — files a request the school admin sees in their panel.

type Status = 'idle' | 'sending' | 'sent';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, { prefillUsername?: string }>, string>>();
  const [username, setUsername] = useState(route.params?.prefillUsername || '');
  const [emailStatus, setEmailStatus] = useState<Status>('idle');
  const [adminStatus, setAdminStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const submitEmail = async () => {
    if (!username.trim() || emailStatus === 'sending') return;
    setEmailStatus('sending');
    setMessage('');
    try {
      await authApi.forgotPasswordEmail(username.trim());
      setEmailStatus('sent');
      setMessage('If your account has an email on file, a reset link is on its way. The link expires in 1 hour.');
    } catch {
      // Endpoint always returns success; this catches only network errors.
      setEmailStatus('idle');
      setMessage('Could not reach the server. Check your connection and try again.');
    }
  };

  const submitAdmin = async () => {
    if (!username.trim() || adminStatus === 'sending') return;
    setAdminStatus('sending');
    setMessage('');
    try {
      await authApi.forgotPassword(username.trim());
      setAdminStatus('sent');
      setMessage('Your school administrator has been notified. They will reset your password and contact you.');
    } catch {
      setAdminStatus('idle');
      setMessage('Could not reach the server. Check your connection and try again.');
    }
  };

  const canType = emailStatus !== 'sending' && adminStatus !== 'sending';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <ArrowLeft size={18} color={colors.text} />
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Forgot password?</Text>
        <Text style={styles.subtitle}>
          Enter your username, then choose how you'd like to reset.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. fisk_username"
            placeholderTextColor={colors.textMuted}
            editable={canType}
            returnKeyType="done"
          />

          {/* Option 1: email link */}
          <TouchableOpacity
            style={[
              styles.optionBtn,
              styles.optionPrimary,
              (!username.trim() || emailStatus === 'sending') && { opacity: 0.6 },
            ]}
            onPress={submitEmail}
            disabled={!username.trim() || emailStatus === 'sending' || emailStatus === 'sent'}
          >
            <View style={styles.optionIconBox}>
              {emailStatus === 'sent'
                ? <CheckCircle2 size={20} color="#fff" />
                : <Mail size={20} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionPrimaryTitle}>
                {emailStatus === 'sending'
                  ? 'Sending…'
                  : emailStatus === 'sent'
                    ? 'Link sent'
                    : 'Email me a reset link'}
              </Text>
              <Text style={styles.optionPrimarySub}>Works if you have an email on file</Text>
            </View>
            {emailStatus === 'sending' && <ActivityIndicator color="#fff" />}
          </TouchableOpacity>

          {/* Option 2: admin request */}
          <TouchableOpacity
            style={[
              styles.optionBtn,
              styles.optionSecondary,
              (!username.trim() || adminStatus === 'sending') && { opacity: 0.6 },
            ]}
            onPress={submitAdmin}
            disabled={!username.trim() || adminStatus === 'sending' || adminStatus === 'sent'}
          >
            <View style={[styles.optionIconBox, { backgroundColor: '#F3F4F6' }]}>
              {adminStatus === 'sent'
                ? <CheckCircle2 size={20} color={colors.primary} />
                : <ShieldCheck size={20} color={colors.primary} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionSecondaryTitle}>
                {adminStatus === 'sending'
                  ? 'Sending…'
                  : adminStatus === 'sent'
                    ? 'Request sent'
                    : 'Ask my school admin'}
              </Text>
              <Text style={styles.optionSecondarySub}>Works for everyone, even without an email</Text>
            </View>
            {adminStatus === 'sending' && <ActivityIndicator color={colors.primary} />}
          </TouchableOpacity>

          {message ? (
            <View style={styles.messageBox}>
              <Text style={styles.messageText}>{message}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.lg },
  backText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.lg },

  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, ...shadow.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
    fontSize: font.md, color: colors.text, backgroundColor: colors.bg,
    marginBottom: spacing.lg,
  },

  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  optionPrimary: { backgroundColor: colors.primary },
  optionSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  optionIconBox: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  optionPrimaryTitle: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  optionPrimarySub: { fontSize: font.xs, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  optionSecondaryTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  optionSecondarySub: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },

  messageBox: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  messageText: { fontSize: font.sm, color: colors.text, lineHeight: 20 },
});
