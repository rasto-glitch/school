import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ShieldCheck, Phone, Mail, Info } from 'lucide-react-native';
import EmailEditModal from '../../components/EmailEditModal';
import SettingsRow from '../../components/settings/SettingsRow';
import LoginFactorToggle from '../../components/settings/LoginFactorToggle';
import { useColors } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { authApi, mfaApi, mfaFactorsApi, type FactorStatus } from '../../services/api';
import { spacing, radius, font } from '../../theme';

// Sign-in & security hub. One screen that presents every two-factor /
// verification method; each row opens its dedicated setup screen.
//
// Today TOTP is the active login second factor; WhatsApp/SMS and email
// codes secure account changes + recovery. The screen is deliberately
// structured as a method chooser so that, when phone/email OTP becomes a
// real login factor, each method just gains a "use at sign-in" control —
// no re-layout needed.
export default function SecurityScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const user = useAuthStore(s => s.user);
  const setPhoneInStore = useAuthStore(s => s.setPhone);
  const setEmailInStore = useAuthStore(s => s.setEmail);
  const [mfaStatus, setMfaStatus] = useState<{ eligible: boolean; confirmed: boolean } | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [loginFactors, setLoginFactors] = useState<FactorStatus[]>([]);

  useEffect(() => {
    let cancelled = false;
    mfaApi.status().then(r => { if (!cancelled) setMfaStatus(r.data); }).catch(() => {});
    mfaFactorsApi.list().then(r => { if (!cancelled) setLoginFactors(r.data.factors || []); }).catch(() => {});
    authApi.getMe()
      .then(r => {
        if (cancelled) return;
        setEmailInStore(r.data.email ?? null);
        setPhoneInStore(r.data.phoneE164 ?? null, r.data.phoneVerifiedAt ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setEmailInStore, setPhoneInStore]);

  const s = makeStyles(colors);
  const Pill = ({ text, on }: { text: string; on: boolean }) => (
    <View style={[s.pill, on ? s.pillOn : s.pillOff]}>
      <Text style={[s.pillText, { color: on ? '#16A34A' : colors.textSecondary }]}>{text}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('security.title', 'Sign-in & security')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}>
        <Text style={s.intro}>{t('security.intro', 'Choose how to protect your account. Pick a method to set it up.')}</Text>

        {mfaStatus?.eligible && (
          <SettingsRow
            icon={<ShieldCheck size={18} color="#6366F1" />}
            iconBg="#EEF2FF"
            label={t('security.method_totp', 'Authenticator app')}
            sub={t('security.method_totp_desc', '6-digit codes from an app. Active at sign-in.')}
            onPress={() => navigation.navigate('MfaSettings')}
            right={<Pill text={mfaStatus.confirmed ? t('security.status_on', 'On') : t('security.status_setup', 'Set up')} on={mfaStatus.confirmed} />}
          />
        )}
        <SettingsRow
          icon={<Phone size={18} color="#10B981" />}
          iconBg="#ECFDF5"
          label={t('security.method_phone', 'WhatsApp / SMS code')}
          sub={t('security.method_phone_desc', 'Codes to your phone. For verification & recovery.')}
          onPress={() => navigation.navigate('PhoneSettings')}
          right={<Pill text={user?.phoneVerifiedAt ? t('security.status_verified', 'Verified') : t('security.status_setup', 'Set up')} on={!!user?.phoneVerifiedAt} />}
        />
        {loginFactors.find(f => f.factor === 'phone') && (
          <LoginFactorToggle
            factor="phone"
            status={loginFactors.find(f => f.factor === 'phone')!}
            canEnable
            multipleArmed={loginFactors.filter(f => f.armed).length > 1}
            onChanged={setLoginFactors}
          />
        )}
        <SettingsRow
          icon={<Mail size={18} color="#6366F1" />}
          iconBg="#EEF2FF"
          label={t('security.method_email', 'Email code')}
          sub={t('security.method_email_desc', 'Codes to your email. For verification & recovery.')}
          onPress={() => setShowEmailModal(true)}
          right={<Pill text={user?.email ? t('security.status_verified', 'Verified') : t('security.status_setup', 'Set up')} on={!!user?.email} />}
        />
        {loginFactors.find(f => f.factor === 'email') && (
          <LoginFactorToggle
            factor="email"
            status={loginFactors.find(f => f.factor === 'email')!}
            canEnable={loginFactors.some(f => f.armed && (f.factor === 'phone' || f.factor === 'totp'))}
            multipleArmed={loginFactors.filter(f => f.armed).length > 1}
            onChanged={setLoginFactors}
          />
        )}

        <View style={s.note}>
          <Info size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
          <Text style={s.noteText}>
            {t('security.login_note', 'Turn on “Use at sign-in” to require a phone or email code each time you sign in. Email can’t be your only method — pair it with phone or an authenticator.')}
          </Text>
        </View>
      </ScrollView>

      <EmailEditModal visible={showEmailModal} onClose={() => setShowEmailModal(false)} currentEmail={user?.email || null} />
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  intro: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillOn: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  pillOff: { backgroundColor: colors.bg, borderColor: colors.border },
  pillText: { fontSize: font.xs, fontWeight: '700' },
  note: {
    flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
  },
  noteText: { flex: 1, fontSize: font.xs, color: colors.textMuted, lineHeight: 17 },
});
