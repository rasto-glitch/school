import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Bell, Globe, User, CheckCircle, XCircle, AlertCircle } from 'lucide-react-native';
import i18n from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { getPushStatus, retryPushRegistration, type PushStatus } from '../../hooks/usePushNotifications';
import { authApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function MeScreen() {
  const { t } = useTranslation();
  const { user, school, logout } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(i18n.language || 'en');
  const [pushStatus, setPushStatus] = useState<PushStatus>(getPushStatus());
  const [retrying, setRetrying] = useState(false);

  const changeLang = (code: string) => {
    setLang(code);
    i18n.changeLanguage(code);
    authApi.updateDeviceLanguage(code).catch(() => {});
  };

  const handleRetryPush = async () => {
    setRetrying(true);
    const result = await retryPushRegistration();
    setPushStatus(result.status);
    setRetrying(false);
    if (result.status === 'registered') Alert.alert('✓ Notifications enabled', 'You will now receive push notifications.');
    else if (result.status === 'denied') Alert.alert('Permission denied', 'Go to Settings → Apps → School Portal → Notifications and enable them.');
    else Alert.alert('Registration failed', result.error ?? 'Unknown error');
  };

  const pushLabel: Record<PushStatus, string> = {
    idle: 'Checking…',
    registered: 'Enabled',
    denied: 'Disabled — tap to fix',
    error: 'Error — tap to retry',
  };
  const pushColor: Record<PushStatus, string> = {
    idle: colors.textMuted,
    registered: colors.success,
    denied: colors.warning,
    error: colors.danger,
  };
  const PushIcon = pushStatus === 'registered' ? CheckCircle : pushStatus === 'denied' ? XCircle : AlertCircle;

  const handleLogout = () => {
    Alert.alert(t('nav.logout'), 'Are you sure you want to sign out?', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nav.logout'), style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <User size={32} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{user?.firstName} {user?.lastName}</Text>
          <Text style={styles.profileUsername}>@{user?.username}</Text>
          {school && <Text style={styles.profileSchool}>{school.name}</Text>}
        </View>
      </View>

      {/* Language */}
      <Text style={styles.sectionTitle}>{t('nav.profile')} & Settings</Text>

      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.iconBox}>
            <Globe size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardLabel}>Language</Text>
        </View>
        <View style={styles.langRow}>
          {LANGUAGES.map(l => (
            <TouchableOpacity
              key={l.code}
              style={[styles.langBtn, lang === l.code && styles.langBtnActive]}
              onPress={() => changeLang(l.code)}
            >
              <Text style={[styles.langBtnText, lang === l.code && styles.langBtnTextActive]}>
                {l.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Push notifications */}
      <TouchableOpacity
        style={styles.card}
        onPress={pushStatus !== 'registered' ? handleRetryPush : undefined}
        disabled={retrying}
        activeOpacity={pushStatus !== 'registered' ? 0.7 : 1}
      >
        <View style={styles.cardRow}>
          <View style={[styles.iconBox, { backgroundColor: pushColor[pushStatus] + '22' }]}>
            <Bell size={18} color={pushColor[pushStatus]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>Push Notifications</Text>
            <Text style={[styles.pushSub, { color: pushColor[pushStatus] }]}>
              {retrying ? 'Registering…' : pushLabel[pushStatus]}
            </Text>
          </View>
          <PushIcon size={18} color={pushColor[pushStatus]} />
        </View>
      </TouchableOpacity>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.logoutText}>{t('nav.logout')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.sm,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  profileName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  profileUsername: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  profileSchool: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  iconBox: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  langRow: { flexDirection: 'row', gap: spacing.sm },
  langBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', backgroundColor: colors.bg,
  },
  langBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  langBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  langBtnTextActive: { color: colors.primary },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.dangerLight,
    borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md,
  },
  logoutText: { fontSize: font.md, fontWeight: '700', color: colors.danger },
  pushSub: { fontSize: font.xs, fontWeight: '600', marginTop: 2 },
});
