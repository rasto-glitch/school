import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  Bell, MapPin, Lock, LogOut, FileText, ShieldCheck, Moon,
  CheckCircle, XCircle, AlertCircle, Mail, Activity, Phone, Bug, KeyRound,
} from 'lucide-react-native';
import EmailEditModal from '../../components/EmailEditModal';
import PasswordChangeModal from '../../components/settings/PasswordChangeModal';
import SettingsRow from '../../components/settings/SettingsRow';
import SectionHeader from '../../components/settings/SectionHeader';
import LanguageSelector from '../../components/settings/LanguageSelector';
import { openLegalPage } from '../../utils/legal';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore, useColors } from '../../store/themeStore';
import { getPushStatus, retryPushRegistration, type PushStatus } from '../../hooks/usePushNotifications';
import { authApi, parentApi } from '../../services/api';
import { spacing, radius, font } from '../../theme';

// Unified, role-aware settings screen. Replaces the four near-identical
// per-role screens (each now re-exports this). Sections are consistent
// everywhere; role only gates the Location block and which rows appear.
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { logout, user } = useAuthStore();
  const setEmailInStore = useAuthStore(s => s.setEmail);
  const setPhoneInStore = useAuthStore(s => s.setPhone);
  const { isDark, toggleTheme } = useThemeStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const role = user?.role;
  const isParent = role === 'parent';
  const showLocation = isParent || role === 'driver';

  const [pushStatus, setPushStatus] = useState<PushStatus>(getPushStatus());
  const [retrying, setRetrying] = useState(false);
  const [pickupSet, setPickupSet] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Refresh cached email + phone from the server on mount (covers logins
  // that predate these fields, plus cross-device verifies / admin edits).
  useEffect(() => {
    let cancelled = false;
    authApi.getMe()
      .then(r => {
        if (cancelled) return;
        setEmailInStore(r.data.email ?? null);
        setPhoneInStore(r.data.phoneE164 ?? null, r.data.phoneVerifiedAt ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setEmailInStore, setPhoneInStore]);

  // Pickup location status (parent only) — re-checked on focus so the icon
  // turns green right after saving.
  useFocusEffect(
    useMemo(() => () => {
      if (!isParent) return;
      let cancelled = false;
      parentApi.getPickupLocation()
        .then(r => { if (!cancelled) setPickupSet(!!(r.data?.latitude && r.data?.longitude)); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [isParent]),
  );

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
    idle: colors.textMuted, registered: colors.success, denied: colors.warning, error: colors.danger,
  };
  const pushLabel: Record<PushStatus, string> = {
    idle: t('settings.push_checking'), registered: t('settings.push_enabled'),
    denied: t('settings.push_disabled'), error: t('settings.push_error'),
  };
  const PushIcon = pushStatus === 'registered' ? CheckCircle : pushStatus === 'denied' ? XCircle : AlertCircle;

  const handleLogout = () => {
    Alert.alert(t('nav.logout'), t('settings.logout_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nav.logout'), style: 'destructive', onPress: logout },
    ]);
  };

  const handleSignOutAll = () => {
    Alert.alert(t('settings.sign_out_all_title'), t('settings.sign_out_all_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.sign_out_all_label'), style: 'destructive',
        onPress: async () => { try { await authApi.logoutAll(); } catch { /* honor intent locally */ } logout(); },
      },
    ]);
  };

  const s = makeStyles(colors);
  const phoneSub = user?.phoneE164
    ? (user.phoneVerifiedAt ? user.phoneE164 : `${user.phoneE164} · ${t('account_settings.phone_unverified_chip', 'Not verified')}`)
    : t('account_settings.phone_not_set', 'Not set');

  return (
    <>
      <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* Account */}
        <SectionHeader title={t('settings.account_section')} first />
        <SettingsRow
          icon={<Mail size={18} color="#6366F1" />} iconBg="#EEF2FF"
          label={t('settings.email_label')}
          sub={user?.email || t('settings.email_not_set')}
          subColor={!user?.email ? colors.warning : undefined}
          onPress={() => setShowEmailModal(true)}
        />
        <SettingsRow
          icon={<Phone size={18} color={user?.phoneVerifiedAt ? '#10B981' : '#D97706'} />}
          iconBg={user?.phoneVerifiedAt ? '#ECFDF5' : '#FEF3C7'}
          label={t('account_settings.phone_section', 'Phone number')}
          sub={phoneSub}
          subColor={!user?.phoneVerifiedAt ? colors.warning : undefined}
          onPress={() => navigation.navigate('PhoneSettings')}
        />
        <SettingsRow
          icon={<Lock size={18} color="#2563EB" />} iconBg="#EFF6FF"
          label={t('settings.reset_password')}
          onPress={() => setShowPasswordModal(true)}
        />

        {/* Security */}
        <SectionHeader title={t('settings.security_section', 'Security')} />
        <SettingsRow
          icon={<ShieldCheck size={18} color="#6366F1" />} iconBg="#EEF2FF"
          label={t('security.title', 'Sign-in & security')}
          sub={t('security.row_sub', 'Two-factor methods & trusted devices')}
          onPress={() => navigation.navigate('Security')}
        />
        <SettingsRow
          icon={<Activity size={18} color="#10B981" />} iconBg="#ECFDF5"
          label={t('sessions.section_title')}
          sub={t('sessions.row_sub')}
          onPress={() => navigation.navigate('Sessions')}
        />
        <SettingsRow
          icon={<LogOut size={18} color="#DC2626" />} iconBg="#FEF2F2"
          label={t('settings.sign_out_all_label')}
          sub={t('settings.sign_out_all_sub')}
          onPress={handleSignOutAll}
        />

        {/* Notifications */}
        <SectionHeader title={t('settings.notifications_section')} />
        <SettingsRow
          icon={<Bell size={18} color={pushColor[pushStatus]} />}
          iconBg={pushColor[pushStatus] + '22'}
          label={t('settings.push_label')}
          sub={retrying ? t('settings.push_registering') : pushLabel[pushStatus]}
          subColor={pushColor[pushStatus]}
          onPress={pushStatus !== 'registered' ? handleRetryPush : undefined}
          disabled={retrying}
          right={<PushIcon size={18} color={pushColor[pushStatus]} />}
        />

        {/* Appearance & language */}
        <SectionHeader title={t('settings.appearance_section')} />
        <SettingsRow
          icon={<Moon size={18} color={isDark ? '#FFFFFF' : colors.textMuted} />}
          iconBg={isDark ? 'transparent' : '#F3F4F6'}
          label={t('settings.dark_mode')}
          sub={isDark ? t('settings.dark_on') : t('settings.dark_off')}
          right={<Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />}
        />
        <LanguageSelector label={t('settings.language_label')} />

        {/* Location (parent + driver) */}
        {showLocation && (
          <>
            <SectionHeader title={t('settings.location_section')} />
            {isParent && (
              <SettingsRow
                icon={<MapPin size={18} color={pickupSet ? '#16A34A' : '#D97706'} />}
                iconBg={pickupSet ? '#F0FDF4' : '#FFFBEB'}
                label={t('settings.pickup_label')}
                sub={t('settings.pickup_sub')}
                onPress={() => navigation.navigate('SetPickupLocation')}
              />
            )}
            <SettingsRow
              icon={<MapPin size={18} color="#16A34A" />} iconBg="#F0FDF4"
              label={t('settings.location_perm_label')}
              sub={t('settings.location_perm_sub')}
              onPress={() => Linking.openSettings()}
            />
          </>
        )}

        {/* Support */}
        <SectionHeader title={t('settings.support_section', 'Support')} />
        <SettingsRow
          icon={<Bug size={18} color="#DC2626" />} iconBg="#FEF2F2"
          label={t('settings.report_bug_label')}
          sub={t('settings.report_bug_sub')}
          onPress={() => navigation.navigate('ReportBug')}
        />
        <SettingsRow
          icon={<ShieldCheck size={18} color={colors.textMuted} />} iconBg="#F3F4F6"
          label={t('settings.privacy')}
          onPress={() => openLegalPage('privacy')}
        />
        <SettingsRow
          icon={<FileText size={18} color={colors.textMuted} />} iconBg="#F3F4F6"
          label={t('settings.terms')}
          onPress={() => openLegalPage('terms')}
        />

        {/* Logout */}
        <SettingsRow
          icon={<KeyRound size={18} color={colors.danger} />} iconBg={colors.dangerLight}
          label={t('nav.logout')}
          onPress={handleLogout}
          showChevron={false}
        />
      </ScrollView>

      <EmailEditModal visible={showEmailModal} onClose={() => setShowEmailModal(false)} currentEmail={user?.email || null} />
      <PasswordChangeModal visible={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
});
