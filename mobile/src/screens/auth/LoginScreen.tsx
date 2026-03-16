import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { School } from '../../types';

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSchools, setLoadingSchools] = useState(true);

  useEffect(() => {
    authApi.getSchools()
      .then(r => { const list = r.data || []; setSchools(list); if (list.length === 1) setSelectedSchool(list[0]); })
      .catch(() => Alert.alert('Error', 'Could not load schools'))
      .finally(() => setLoadingSchools(false));
  }, []);

  const handleLogin = async () => {
    if (!selectedSchool) { Alert.alert('', 'Please select a school'); return; }
    if (!username || !password) { Alert.alert('', 'Please enter your username and password'); return; }
    setLoading(true);
    try {
      const res = await authApi.login(username, password, selectedSchool.slug);
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
          <Text style={styles.label}>School</Text>
          {loadingSchools ? (
            <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.md }} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {schools.map(s => (
                <TouchableOpacity key={s.id} style={[styles.chip, selectedSchool?.id === s.id && styles.chipActive]} onPress={() => setSelectedSchool(s)}>
                  <Text style={[styles.chipText, selectedSchool?.id === s.id && styles.chipTextActive]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

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
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.bg },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: font.md, color: colors.text, marginBottom: spacing.md, backgroundColor: colors.bg },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: colors.textInverse, fontSize: font.md, fontWeight: '700' },
});
