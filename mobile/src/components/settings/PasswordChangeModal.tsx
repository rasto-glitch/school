import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Modal, StyleSheet, Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { authApi } from '../../services/api';
import { isStrongPassword } from '../../utils/passwordPolicy';
import { spacing, radius, font } from '../../theme';

// Change-password + forgot-password modal. Previously hand-rolled and
// duplicated in all four role settings screens; now one shared component.
export default function PasswordChangeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sendingForgot, setSendingForgot] = useState(false);
  const [sendingForgotEmail, setSendingForgotEmail] = useState(false);

  const close = () => {
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    onClose();
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) { Alert.alert('', t('settings.passwords_no_match')); return; }
    if (!isStrongPassword(newPassword)) { Alert.alert('', t('settings.password_short')); return; }
    setChangingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      Alert.alert('✓', t('settings.change_success'));
      close();
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

  const handleForgotPasswordEmail = async () => {
    if (!user?.username) return;
    setSendingForgotEmail(true);
    try {
      await authApi.forgotPasswordEmail(user.username);
      Alert.alert(t('settings.forgot_email_sent_title'), t('settings.forgot_email_sent_body'));
    } catch {
      Alert.alert(t('common.error'), t('settings.reset_email_failed'));
    } finally {
      setSendingForgotEmail(false);
    }
  };

  const s = makeStyles(colors);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[s.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>{t('settings.reset_password')}</Text>
          <TouchableOpacity onPress={close}><X size={22} color={colors.textMuted} /></TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={s.modalSection}>{t('settings.password_section_change')}</Text>
          <Text style={s.fieldLabel}>{t('settings.current_password')}</Text>
          <TextInput style={s.input} secureTextEntry placeholder="••••••" placeholderTextColor={colors.textMuted} value={currentPassword} onChangeText={setCurrentPassword} />
          <Text style={s.fieldLabel}>{t('settings.new_password')}</Text>
          <TextInput style={s.input} secureTextEntry placeholder="••••••" placeholderTextColor={colors.textMuted} value={newPassword} onChangeText={setNewPassword} />
          <Text style={s.fieldLabel}>{t('settings.confirm_password')}</Text>
          <TextInput style={s.input} secureTextEntry placeholder="••••••" placeholderTextColor={colors.textMuted} value={confirmPassword} onChangeText={setConfirmPassword} />
          <TouchableOpacity style={s.submitBtn} onPress={handleChangePassword} disabled={changingPassword}>
            <Text style={s.submitText}>{changingPassword ? t('settings.changing') : t('settings.change_btn')}</Text>
          </TouchableOpacity>

          <View style={s.divider} />

          <Text style={s.modalSection}>{t('settings.forgot_title')}</Text>
          <Text style={s.forgotDesc}>{t('settings.forgot_desc')}</Text>
          <TouchableOpacity style={[s.submitBtn, sendingForgotEmail && { opacity: 0.6 }]} onPress={handleForgotPasswordEmail} disabled={sendingForgotEmail || sendingForgot}>
            <Text style={s.submitText}>{sendingForgotEmail ? t('settings.forgot_email_sending') : t('settings.forgot_email_btn')}</Text>
          </TouchableOpacity>
          <Text style={s.forgotHint}>{t('settings.forgot_email_hint')}</Text>
          <TouchableOpacity style={[s.forgotBtn, { marginTop: spacing.sm }, sendingForgot && { opacity: 0.6 }]} onPress={handleForgotPassword} disabled={sendingForgot || sendingForgotEmail}>
            <Text style={s.forgotBtnText}>{sendingForgot ? t('settings.forgot_sending') : t('settings.forgot_admin_btn')}</Text>
          </TouchableOpacity>
          <Text style={s.forgotHint}>{t('settings.forgot_admin_hint')}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  modal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  modalSection: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  submitBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  submitText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  forgotDesc: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  forgotHint: { fontSize: font.xs, color: colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  forgotBtn: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  forgotBtnText: { fontSize: font.md, fontWeight: '700', color: colors.primary },
});
