import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Switch, Linking, Modal, TextInput,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Bell, MapPin, Globe, Lock, LogOut, FileText, ShieldCheck,
  Moon, ChevronRight, CheckCircle, XCircle, AlertCircle, X, Activity, Phone,
} from 'lucide-react-native';
import { openLegalPage } from '../../utils/legal';
import i18n, { changeLanguageAndApply } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore, useColors } from '../../store/themeStore';
import { getPushStatus, retryPushRegistration, type PushStatus } from '../../hooks/usePushNotifications';
import { authApi } from '../../services/api';
import { isStrongPassword } from '../../utils/passwordPolicy';
import { spacing, radius, font, shadow } from '../../theme';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function DriverSettingsScreen() {
  const { t } = useTranslation();
  const { logout, user } = useAuthStore();
  const { isDark, toggleTheme } = useThemeStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [lang, setLang] = useState(i18n.language || 'en');
  const [pushStatus, setPushStatus] = useState<PushStatus>(getPushStatus());
  const [retrying, setRetrying] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sendingForgot, setSendingForgot] = useState(false);

  useEffect(() => {
    const handler = (lng: string) => setLang(lng);
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, []);

  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const changeLang = (code: string) => {
    setLang(code);
    changeLanguageAndApply(code);
    authApi.updateDeviceLanguage(code).catch(() => {});
  };

  const handleRetryPush = async () => {
    setRetrying(true);
    const result = await retryPushRegistration();
    setPushStatus(result.status);
    setRetrying(false);
    if (result.status === 'registered') Alert.alert('✓ ' + t('settings.push_ok_title'), t('settings.push_ok_body'));
    else if (result.status === 'denied') Alert.alert(t('settings.push_denied_title'), t('settings.push_denied_body'));
    else Alert.alert(t('common.failed'), result.error ?? t('settings.unknown_error'));
  };

  const pushColor: Record<PushStatus, string> = {
    idle: colors.textMuted,
    registered: colors.success,
    denied: colors.warning,
    error: colors.danger,
  };
  const pushLabel: Record<PushStatus, string> = {
    idle: t('settings.push_checking'),
    registered: t('settings.push_enabled'),
    denied: t('settings.push_disabled'),
    error: t('settings.push_error'),
  };
  const PushIcon = pushStatus === 'registered' ? CheckCircle : pushStatus === 'denied' ? XCircle : AlertCircle;

  const handleLogout = () => {
    Alert.alert(t('nav.logout'), t('settings.logout_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nav.logout'), style: 'destructive', onPress: logout },
    ]);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      Alert.alert('', t('settings.passwords_no_match'));
      return;
    }
    if (!isStrongPassword(newPassword)) {
      Alert.alert('', t('settings.password_short'));
      return;
    }
    setChangingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      Alert.alert('✓', t('settings.change_success'));
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setShowPasswordModal(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error ?? t('settings.change_failed'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!user?.username) return;
    setSendingForgot(true);
    try {
      await authApi.forgotPassword(user.username);
      Alert.alert(t('settings.forgot_sent_title'), t('settings.forgot_sent_body'));
    } catch {
      Alert.alert(t('common.error'), t('settings.reset_request_failed'));
    } finally {
      setSendingForgot(false);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Notifications */}
        <Text style={styles.sectionTitle}>{t('settings.notifications_section')}</Text>
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
            <Text style={styles.rowLabel}>{t('settings.push_label')}</Text>
            <Text style={[styles.rowSub, { color: pushColor[pushStatus] }]}>
              {retrying ? t('settings.push_registering') : pushLabel[pushStatus]}
            </Text>
          </View>
          <PushIcon size={18} color={pushColor[pushStatus]} />
        </TouchableOpacity>

        {/* Location */}
        <Text style={styles.sectionTitle}>{t('settings.location_section')}</Text>
        <TouchableOpacity style={styles.row} onPress={() => Linking.openSettings()}>
          <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
            <MapPin size={18} color="#16A34A" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('settings.location_perm_label')}</Text>
            <Text style={styles.rowSub}>{t('settings.location_perm_sub')}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Appearance */}
        <Text style={styles.sectionTitle}>{t('settings.appearance_section')}</Text>
        <View style={styles.row}>
          <View style={[
            styles.iconBox,
            isDark
              ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FFFFFF' }
              : { backgroundColor: '#F3F4F6' },
          ]}>
            <Moon size={18} color={isDark ? '#FFFFFF' : colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('settings.dark_mode')}</Text>
            <Text style={styles.rowSub}>{isDark ? t('settings.dark_on') : t('settings.dark_off')}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Language */}
        <Text style={styles.sectionTitle}>{t('settings.language_section')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[
              styles.iconBox,
              isDark
                ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FFFFFF' }
                : { backgroundColor: colors.primaryLight },
            ]}>
              <Globe size={18} color={isDark ? '#FFFFFF' : colors.primary} />
            </View>
            <Text style={styles.rowLabel}>{t('settings.language_label')}</Text>
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
        <Text style={styles.sectionTitle}>{t('settings.account_section')}</Text>
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('PhoneSettings')}>
          <View style={[styles.iconBox, { backgroundColor: user?.phoneVerifiedAt ? '#ECFDF5' : '#FEF3C7' }]}>
            <Phone size={18} color={user?.phoneVerifiedAt ? '#10B981' : '#D97706'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('account_settings.phone_section', 'Phone number')}</Text>
            <Text
              style={[styles.rowSub, !user?.phoneVerifiedAt && { color: colors.warning }]}
              numberOfLines={1}
            >
              {user?.phoneE164
                ? (user.phoneVerifiedAt
                    ? user.phoneE164
                    : `${user.phoneE164} · ${t('account_settings.phone_unverified_chip', 'Not verified')}`)
                : t('account_settings.phone_not_set', 'Not set')}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => setShowPasswordModal(true)}>
          <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
            <Lock size={18} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('settings.reset_password')}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Sessions')}>
          <View style={[styles.iconBox, { backgroundColor: '#ECFDF5' }]}>
            <Activity size={18} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('sessions.section_title')}</Text>
            <Text style={styles.rowSub}>{t('sessions.row_sub')}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => openLegalPage('privacy')}>
          <View style={[styles.iconBox, { backgroundColor: '#F3F4F6' }]}>
            <ShieldCheck size={18} color={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('settings.privacy')}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => openLegalPage('terms')}>
          <View style={[styles.iconBox, { backgroundColor: '#F3F4F6' }]}>
            <FileText size={18} color={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{t('settings.terms')}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutRow} onPress={handleLogout}>
          <LogOut size={18} color={colors.danger} />
          <Text style={styles.logoutText}>{t('nav.logout')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Password Modal */}
      <Modal visible={showPasswordModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('settings.reset_password')}</Text>
            <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
              <X size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalSection}>{t('settings.password_section_change')}</Text>
            <Text style={styles.fieldLabel}>{t('settings.current_password')}</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              placeholder="••••••"
              placeholderTextColor={colors.textMuted}
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <Text style={styles.fieldLabel}>{t('settings.new_password')}</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              placeholder="••••••"
              placeholderTextColor={colors.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <Text style={styles.fieldLabel}>{t('settings.confirm_password')}</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              placeholder="••••••"
              placeholderTextColor={colors.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity style={styles.submitBtn} onPress={handleChangePassword} disabled={changingPassword}>
              <Text style={styles.submitText}>
                {changingPassword ? t('settings.changing') : t('settings.change_btn')}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.modalSection}>{t('settings.forgot_title')}</Text>
            <Text style={styles.forgotDesc}>{t('settings.forgot_desc')}</Text>
            <TouchableOpacity style={styles.forgotBtn} onPress={handleForgotPassword} disabled={sendingForgot}>
              <Text style={styles.forgotBtnText}>
                {sendingForgot ? t('settings.forgot_sending') : t('settings.forgot_btn')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
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
    borderWidth: 1.5, borderColor: isDark ? '#FFFFFF' : colors.border,
    alignItems: 'center', backgroundColor: isDark ? 'transparent' : colors.bg,
  },
  langBtnActive: {
    borderColor: isDark ? '#FFFFFF' : colors.primary,
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
  },
  langBtnText: { fontSize: font.sm, fontWeight: '600', color: isDark ? '#FFFFFF' : colors.textSecondary },
  langBtnTextActive: { color: isDark ? '#000000' : colors.primary },
  logoutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.dangerLight,
    borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg,
  },
  logoutText: { fontSize: font.md, fontWeight: '700', color: colors.danger },
  modal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  modalSection: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.md,
  },
  submitText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  forgotDesc: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  forgotBtn: {
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
  },
  forgotBtnText: { fontSize: font.md, fontWeight: '700', color: colors.primary },
});
