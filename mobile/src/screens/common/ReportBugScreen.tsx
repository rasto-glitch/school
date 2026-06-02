import { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Modal, Image, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Device from 'expo-device';
import { Bug, Paperclip, X, CheckCircle, Image as ImageIcon, Video as VideoIcon } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { bugReportApi, authApi } from '../../services/api';
import i18n from '../../i18n';
import { spacing, radius, font, shadow } from '../../theme';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_DESCRIPTION = 4000;

interface Picked {
  uri: string;
  name: string;
  type: string;
  size?: number;
  isVideo: boolean;
}

export default function ReportBugScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const styles = makeStyles(colors);

  const pickAttachment = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('bug.perm_title'), t('bug.perm_body'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_FILE_BYTES) {
      Alert.alert(t('bug.too_large_title'), t('bug.too_large_body'));
      return;
    }

    const isVideo = asset.type === 'video';
    const fallbackName = `${isVideo ? 'video' : 'image'}_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
    setPicked({
      uri: asset.uri,
      name: asset.fileName || fallbackName,
      type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      size: asset.fileSize,
      isVideo,
    });
  };

  const removeAttachment = () => setPicked(null);

  const submit = async (isRetry = false) => {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    try {
      await bugReportApi.submit(
        description.trim(),
        {
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          brand: Device.brand || undefined,
          model: Device.modelName || undefined,
          locale: i18n.language || undefined,
        },
        picked && {
          uri: picked.uri,
          name: picked.name,
          type: picked.type,
        },
      );
      Alert.alert(
        '✓ ' + t('bug.success_title'),
        t('bug.success_body'),
        [{ text: t('common.ok'), onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      if (err?.code === 'no_email_on_profile' && !isRetry) {
        setEmailModalOpen(true);
      } else if (err?.code === 'no_email_on_profile') {
        Alert.alert(t('bug.error_title'), t('bug.email_save_failed'));
      } else {
        Alert.alert(t('bug.error_title'), err?.message || t('bug.error_body'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const saveEmail = async () => {
    const clean = emailDraft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      Alert.alert(t('bug.email_invalid'));
      return;
    }
    if (!emailPassword) {
      Alert.alert(t('bug.email_password_required'));
      return;
    }
    setSavingEmail(true);
    try {
      await authApi.updateMyEmail(clean, emailPassword);
      setEmailModalOpen(false);
      setEmailPassword('');
      // Auto-retry once now that they have an email. The retry flag stops a
      // loop if the server still rejects (modal won't reopen).
      setTimeout(() => submit(true), 50);
    } catch (e: any) {
      Alert.alert(t('bug.error_title'), e?.response?.data?.error || t('bug.email_save_failed'));
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroBox}>
          <View style={styles.heroIcon}>
            <Bug size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{t('bug.title')}</Text>
            <Text style={styles.heroSub}>{t('bug.hero_sub')}</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>{t('bug.description_label')}</Text>
        <TextInput
          style={styles.textarea}
          placeholder={t('bug.description_placeholder')}
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={text => setDescription(text.slice(0, MAX_DESCRIPTION))}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{description.length} / {MAX_DESCRIPTION}</Text>

        <Text style={styles.fieldLabel}>{t('bug.attachment_label')}</Text>
        <Text style={styles.fieldHint}>{t('bug.attachment_hint')}</Text>

        {picked ? (
          <View style={styles.preview}>
            {picked.isVideo ? (
              <View style={styles.videoPlaceholder}>
                <VideoIcon size={28} color={colors.textMuted} />
              </View>
            ) : (
              <Image source={{ uri: picked.uri }} style={styles.previewImage} />
            )}
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text style={styles.previewName} numberOfLines={1}>{picked.name}</Text>
              <Text style={styles.previewMeta}>
                {picked.isVideo ? t('bug.video') : t('bug.image')}
                {typeof picked.size === 'number' && ` · ${fmtSize(picked.size)}`}
              </Text>
            </View>
            <TouchableOpacity onPress={removeAttachment} style={styles.removeBtn}>
              <X size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.attachBtn} onPress={pickAttachment} activeOpacity={0.7}>
            <View style={styles.attachIconRow}>
              <ImageIcon size={20} color={colors.primary} />
              <VideoIcon size={20} color={colors.primary} />
            </View>
            <Text style={styles.attachBtnText}>{t('bug.attach_button')}</Text>
            <Paperclip size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!description.trim() || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={() => submit()}
          disabled={!description.trim() || submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.submitBtnText}>
            {submitting ? t('bug.sending') : t('bug.submit')}
          </Text>
        </TouchableOpacity>

        <Text style={styles.privacyNote}>{t('bug.privacy_note')}</Text>
      </ScrollView>

      {/* Set email modal — opens when backend returns no_email_on_profile */}
      <Modal visible={emailModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEmailModalOpen(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('bug.email_modal_title')}</Text>
            <TouchableOpacity onPress={() => setEmailModalOpen(false)}>
              <X size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalBody}>{t('bug.email_modal_body')}</Text>

          <Text style={styles.fieldLabel}>{t('bug.email_field_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            value={emailDraft}
            onChangeText={setEmailDraft}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <Text style={styles.fieldLabel}>{t('bug.email_password_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            value={emailPassword}
            onChangeText={setEmailPassword}
            secureTextEntry
            autoComplete="current-password"
          />

          <TouchableOpacity
            style={[styles.submitBtn, (savingEmail || !emailPassword) && styles.submitBtnDisabled]}
            onPress={saveEmail}
            disabled={savingEmail || !emailPassword}
            activeOpacity={0.85}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <CheckCircle size={18} color="#fff" />
              <Text style={styles.submitBtnText}>
                {savingEmail ? t('bug.email_saving') : t('bug.email_save_and_submit')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },

  heroBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg, ...shadow.sm,
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: radius.sm,
    backgroundColor: '#DC2626',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  heroSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2, lineHeight: 16 },

  fieldLabel: {
    fontSize: font.sm, fontWeight: '700', color: colors.textSecondary,
    marginBottom: 6, marginTop: spacing.sm,
  },
  fieldHint: { fontSize: font.xs, color: colors.textMuted, marginBottom: spacing.xs },

  textarea: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
    minHeight: 140,
  },
  charCount: { fontSize: font.xs, color: colors.textMuted, textAlign: 'right', marginTop: 4 },

  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  attachIconRow: { flexDirection: 'row', gap: 6 },
  attachBtnText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },

  preview: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  previewImage: { width: 56, height: 56, borderRadius: radius.sm },
  videoPlaceholder: {
    width: 56, height: 56, borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  previewName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  previewMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  removeBtn: { padding: spacing.xs },

  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },

  privacyNote: {
    fontSize: font.xs, color: colors.textMuted,
    textAlign: 'center', marginTop: spacing.md, lineHeight: 16,
  },

  modal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  modalBody: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
});
