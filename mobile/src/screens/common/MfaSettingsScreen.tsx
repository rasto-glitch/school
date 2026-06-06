import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, Modal, Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ShieldCheck, ChevronLeft, CheckCircle, AlertTriangle, KeyRound, Trash2, X, Share2,
} from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { mfaApi, trustedDeviceApi } from '../../services/api';
import MfaEnrollPanel from '../../components/MfaEnrollPanel';
import { spacing, radius, font } from '../../theme';

type Step = 'idle' | 'enrolling';

// Authenticated-side MFA management for mobile. Eligible roles (teacher,
// supervisor in Phase 2) can opt in voluntarily here, disable, regen
// recovery codes, and manage trusted devices — same surfaces as the web
// AccountSettingsModal section. Admin + accountant are role-blocked
// from mobile entirely so they never see this screen.

interface TrustedDevice {
  id: string; device_label: string | null; user_agent: string | null;
  ip: string | null; created_at: string; last_seen_at: string; expires_at: string;
}

export default function MfaSettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const styles = makeStyles(colors);

  const [status, setStatus] = useState<{ eligible: boolean; enrolled: boolean; confirmed: boolean; recoveryCodesRemaining: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('idle');

  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Disable modal state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Regen modal state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await mfaApi.status();
      setStatus(r.data);
      if (r.data.confirmed) {
        const td = await trustedDeviceApi.list();
        setTrustedDevices(td.data.devices || []);
      } else {
        setTrustedDevices(null);
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const onDisable = async () => {
    if (!disablePassword || !/^\d{6}$/.test(disableCode)) {
      Alert.alert('', t('mfa.disable_inputs_required'));
      return;
    }
    setDisabling(true);
    try {
      await mfaApi.disableSelf(disablePassword, disableCode);
      Alert.alert('', t('mfa.disable_success'));
      setDisableOpen(false);
      setDisablePassword(''); setDisableCode('');
      await refresh();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || t('mfa.disable_failed'));
    } finally {
      setDisabling(false);
    }
  };

  const onRegen = async () => {
    if (!/^\d{6}$/.test(regenCode)) {
      Alert.alert('', t('mfa.code_invalid_format'));
      return;
    }
    setRegenerating(true);
    try {
      const r = await mfaApi.regenerateRecoveryCodes(regenCode);
      setNewCodes(r.data.recoveryCodes);
      setRegenOpen(false);
      setRegenCode('');
      await refresh();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || t('mfa.regen_failed'));
    } finally {
      setRegenerating(false);
    }
  };

  const onRevokeDevice = (id: string) => {
    Alert.alert(
      t('mfa.trust_revoke_title'),
      t('mfa.trust_revoke_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('mfa.trust_revoke'),
          style: 'destructive',
          onPress: async () => {
            setRevokingId(id);
            try {
              await trustedDeviceApi.revoke(id);
              setTrustedDevices(prev => (prev || []).filter(d => d.id !== id));
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.response?.data?.error || t('mfa.trust_revoke_failed'));
            } finally {
              setRevokingId(null);
            }
          },
        },
      ],
    );
  };

  if (step === 'enrolling') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep('idle')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('mfa.setup_title')}</Text>
          <View style={{ width: 22 }} />
        </View>
        <MfaEnrollPanel
          mode="authenticated"
          rememberDevice={false}
          onRememberDeviceChange={() => {}}
          onSuccess={() => { setStep('idle'); void refresh(); }}
          onCancel={() => setStep('idle')}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('mfa.section_title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : !status?.eligible ? (
          <View style={styles.card}>
            <AlertTriangle size={20} color={colors.warning} />
            <Text style={styles.cardText}>{t('mfa.ineligible_body')}</Text>
          </View>
        ) : !status.confirmed ? (
          <>
            <View style={styles.card}>
              <ShieldCheck size={22} color={colors.primary} />
              <Text style={styles.cardText}>{t('mfa.not_enrolled_body')}</Text>
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('enrolling')}>
              <Text style={styles.primaryBtnText}>{t('mfa.enroll_action')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.card, { borderColor: '#10B981', borderWidth: 1 }]}>
              <CheckCircle size={22} color="#10B981" />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardText}>{t('mfa.enabled_summary')}</Text>
                <Text style={styles.cardSub}>
                  {t('mfa.recovery_remaining', { count: status.recoveryCodesRemaining })}
                </Text>
              </View>
            </View>

            {newCodes && (
              <View style={[styles.card, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderWidth: 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardText, { color: '#92400E', fontWeight: '700' }]}>{t('mfa.recovery_save_title')}</Text>
                  <Text style={[styles.cardSub, { color: '#92400E' }]}>{t('mfa.recovery_save_body')}</Text>
                  <View style={styles.codesGrid}>
                    {newCodes.map((c, i) => (
                      <Text key={i} selectable style={styles.codeItem}>{c}</Text>
                    ))}
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        await Share.share({
                          message: 'Scholify two-factor recovery codes\n\nEach code works ONCE.\n\n' + newCodes.join('\n'),
                          title: t('mfa.recovery_save_title'),
                        });
                      } catch { /* user dismissed */ }
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm }}
                  >
                    <Share2 size={14} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: '600', fontSize: font.sm }}>{t('mfa.share_codes')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setNewCodes(null)} style={{ alignSelf: 'flex-end', marginTop: spacing.sm }}>
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('common.close')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.outlineBtn} onPress={() => setRegenOpen(true)}>
              <KeyRound size={16} color={colors.primary} />
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{t('mfa.regen_open')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, { borderColor: colors.danger }]} onPress={() => setDisableOpen(true)}>
              <Trash2 size={16} color={colors.danger} />
              <Text style={[styles.outlineBtnText, { color: colors.danger }]}>{t('mfa.disable_open')}</Text>
            </TouchableOpacity>

            {/* Trusted devices */}
            <Text style={styles.sectionHeading}>{t('mfa.trust_section_title')}</Text>
            <Text style={styles.sectionBody}>{t('mfa.trust_section_body')}</Text>
            {!trustedDevices ? (
              <ActivityIndicator color={colors.textMuted} />
            ) : trustedDevices.length === 0 ? (
              <Text style={styles.muted}>{t('mfa.trust_none')}</Text>
            ) : (
              trustedDevices.map(d => (
                <View key={d.id} style={styles.deviceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceLabel}>{d.device_label || t('mfa.trust_unknown_device')}</Text>
                    <Text style={styles.deviceSub}>
                      {t('mfa.trust_last_seen')}: {new Date(d.last_seen_at).toLocaleString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => onRevokeDevice(d.id)}
                    disabled={revokingId === d.id}
                  >
                    {revokingId === d.id
                      ? <ActivityIndicator color={colors.danger} />
                      : <Text style={{ color: colors.danger, fontWeight: '700', fontSize: font.sm }}>{t('mfa.trust_revoke')}</Text>}
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Disable modal */}
      <Modal visible={disableOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDisableOpen(false)}>
        <View style={[styles.modalRoot, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('mfa.disable_open')}</Text>
            <TouchableOpacity onPress={() => setDisableOpen(false)}><X size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <Text style={styles.cardSub}>{t('mfa.disable_body')}</Text>
          <Text style={styles.smallLabel}>{t('account_settings.confirm_with_password')}</Text>
          <TextInput
            style={styles.input}
            value={disablePassword}
            onChangeText={setDisablePassword}
            secureTextEntry
            autoComplete="current-password"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.smallLabel}>{t('mfa.code_label')}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={disableCode}
            onChangeText={v => setDisableCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
            placeholderTextColor={colors.textMuted}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.danger }, (disabling || !disablePassword || disableCode.length !== 6) && { opacity: 0.5 }]}
            onPress={onDisable}
            disabled={disabling || !disablePassword || disableCode.length !== 6}
          >
            {disabling ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('mfa.disable_action')}</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Regen modal */}
      <Modal visible={regenOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegenOpen(false)}>
        <View style={[styles.modalRoot, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('mfa.regen_open')}</Text>
            <TouchableOpacity onPress={() => setRegenOpen(false)}><X size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <Text style={styles.cardSub}>{t('mfa.regen_body')}</Text>
          <Text style={styles.smallLabel}>{t('mfa.code_label')}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={regenCode}
            onChangeText={v => setRegenCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
            placeholderTextColor={colors.textMuted}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (regenerating || regenCode.length !== 6) && { opacity: 0.5 }]}
            onPress={onRegen}
            disabled={regenerating || regenCode.length !== 6}
          >
            {regenerating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('mfa.regen_action')}</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
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
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },
  cardSub: { fontSize: font.xs, color: colors.textSecondary, lineHeight: 16, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginBottom: spacing.sm },
  primaryBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    marginBottom: spacing.sm,
  },
  outlineBtnText: { fontSize: font.sm, fontWeight: '600' },
  sectionHeading: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: 4 },
  sectionBody: { fontSize: font.xs, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 16 },
  muted: { fontSize: font.xs, color: colors.textMuted, fontStyle: 'italic' },
  deviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, padding: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs,
  },
  deviceLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  deviceSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  modalRoot: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  smallLabel: { fontSize: font.xs, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22, fontVariant: ['tabular-nums'] },
  codesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  codeItem: { fontFamily: 'monospace', fontSize: font.sm, color: '#92400E', width: '47%' },
});
