import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, radius, font, shadow } from '../../theme';

export default function LoginScreen() {
  const { setAuth, selectedSchool: storedSchool, setSelectedSchool } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!storedSchool) { Alert.alert('', 'No school selected'); return; }
    if (!username || !password) { Alert.alert('', 'Please enter your username and password'); return; }
    setLoading(true);
    try {
      const res = await authApi.login(username, password, storedSchool.slug);
      setAuth(res.data.token, res.data.user, res.data.school);
    } catch (err: any) {
      Alert.alert('Sign In Failed', err.response?.data?.error || 'Invalid username or password');
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
          <View style={styles.logoBox}><Text style={styles.logoText}>S</Text></View>
          <Text style={styles.brandTitle}>School Portal</Text>
          <Text style={styles.brandSub}>Sign in to your account</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.schoolRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>School</Text>
              <Text style={styles.schoolName}>{storedSchool?.name}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedSchool(null as any)} style={styles.changeBtn}>
              <Text style={styles.changeBtnText}>Change</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Username</Text>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="Enter your username" placeholderTextColor={colors.textMuted} returnKeyType="next" />

          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Enter your password" placeholderTextColor={colors.textMuted} returnKeyType="done" onSubmitEditing={handleLogin} />

          <TouchableOpacity style={[styles.btn, loading && { opacity: 0.7 }]} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.btnText}>Sign In</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoBox: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md, ...shadow.md },
  logoText: { fontSize: 28, fontWeight: '800', color: colors.textInverse },
  brandTitle: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  brandSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, ...shadow.md },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 6 },
  schoolRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm },
  schoolName: { fontSize: font.md, fontWeight: '600', color: colors.text, marginTop: 2 },
  changeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.primary },
  changeBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: font.md, color: colors.text, marginBottom: spacing.md, backgroundColor: colors.bg },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: colors.textInverse, fontSize: font.md, fontWeight: '700' },
});
