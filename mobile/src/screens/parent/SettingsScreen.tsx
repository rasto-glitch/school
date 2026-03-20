import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Switch, Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Bell, MapPin, Globe, Lock, LogOut, FileText,
  Moon, ChevronRight, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { LANGUAGE_KEY } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore, useColors } from '../../store/themeStore';
import { getPushStatus, retryPushRegistration, type PushStatus } from '../../hooks/usePushNotifications';
import { authApi } from '../../services/api';
import { spacing, radius, font, shadow } from '../../theme';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { logout } = useAuthStore();
  const { isDark, toggleTheme } = useThemeStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [lang, setLang] = useState(i18n.language || 'en');
  const [pushStatus, setPushStatus] = useState<PushStatus>(getPushStatus());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const handler = (lng: string) => setLang(lng);
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, []);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  const changeLang = (code: string) => {
    setLang(code);
    i18n.changeLanguage(code);
    AsyncStorage.setItem(LANGUAGE_KEY, code);
    authApi.updateDeviceLanguage(code).catch(() => {});
  };

  const handleRetryPush = async () => {
    setRetrying(true);
    const result = await retryPushRegistration();
    setPushStatus(result.status);
    setRetrying(false);
    if (result.status === 'registered') Alert.alert('✓ Enabled', 'Push notifications are now enabled.');
    else if (result.status === 'denied') Alert.alert('Permission denied', 'Go to Settings → Apps → School Portal → Notifications and enable them.');
    else Alert.alert('Failed', result.error ?? 'Unknown error');
  };

  const pushColor: Record<PushStatus, string> = {
    idle: colors.textMuted,
    registered: colors.success,
    denied: colors.warning,
    error: colors.danger,
  };
  const pushLabel: Record<PushStatus, string> = {
    idle: 'Checking…',
    registered: 'Enabled',
    denied: 'Disabled — tap to enable',
    error: 'Error — tap to retry',
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
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      {/* Notifications */}
      <Text style={styles.sectionTitle}>Notifications</Text>
      <TouchableOpacity
        style={styles.row}
        onPress={pushStatus !== 'registered' ? handleRetryPush : undefined}
        disabled={retrying}
        activeOpacity={pushStatus !== 'registered' ? 0.7 : 1}
      >
        <View style={[styles.iconBox, { backgroundColor: pushColor[pushStatus] + '22' }]}>
          <Bell size={18} color={pushColor[pushStatus]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Push Notifications</Text>
          <Text style={[styles.rowSub, { color: pushColor[pushStatus] }]}>
            {retrying ? 'Registering…' : pushLabel[pushStatus]}
          </Text>
        </View>
        <PushIcon size={18} color={pushColor[pushStatus]} />
      </TouchableOpacity>

      {/* Location */}
      <Text style={styles.sectionTitle}>Location</Text>
      <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('SetPickupLocation')}>
        <View style={[styles.iconBox, { backgroundColor: '#FFFBEB' }]}>
          <MapPin size={18} color="#D97706" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Pickup Location</Text>
          <Text style={styles.rowSub}>Set where the bus should alert you</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => Linking.openSettings()}>
        <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
          <MapPin size={18} color="#16A34A" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Location Permission</Text>
          <Text style={styles.rowSub}>Manage in device settings</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Appearance */}
      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: isDark ? '#1E1B4B' : '#F3F4F6' }]}>
          <Moon size={18} color={isDark ? colors.primary : colors.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Dark Mode</Text>
          <Text style={styles.rowSub}>{isDark ? 'On' : 'Off'}</Text>
        </View>
        <Switch
          value={isDark}
          onValueChange={toggleTheme}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </View>

      {/* Language */}
      <Text style={styles.sectionTitle}>Language</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
            <Globe size={18} color={colors.primary} />
          </View>
          <Text style={styles.rowLabel}>Display Language</Text>
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

      {/* Account */}
      <Text style={styles.sectionTitle}>Account</Text>
      <TouchableOpacity style={styles.row} onPress={() => Alert.alert('Reset Password', 'A password reset link will be sent to your email.')}>
        <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
          <Lock size={18} color="#2563EB" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Reset Password</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => Alert.alert('Terms of Service', 'Terms of Service content coming soon.')}>
        <View style={[styles.iconBox, { backgroundColor: '#F3F4F6' }]}>
          <FileText size={18} color={colors.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Terms of Service</Text>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.logoutRow} onPress={handleLogout}>
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.logoutText}>{t('nav.logout')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  sectionTitle: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: 2, ...shadow.sm,
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: 2, ...shadow.sm,
  },
  iconBox: {
    width: 34, height: 34, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  langRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  langBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', backgroundColor: colors.bg,
  },
  langBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  langBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  langBtnTextActive: { color: colors.primary },
  logoutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.dangerLight,
    borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg,
  },
  logoutText: { fontSize: font.md, fontWeight: '700', color: colors.danger },
});
