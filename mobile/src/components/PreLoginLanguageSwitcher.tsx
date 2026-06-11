import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, FlatList } from 'react-native';
import { Globe, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import i18n, { changeLanguageAndApply } from '../i18n';
import { useColors } from '../store/themeStore';
import { authApi } from '../services/api';
import { font, radius, spacing } from '../theme';

// Pre-login language picker. Rendered on Login + ForgotPassword +
// ForceChangePassword. Settings has a richer language section for the
// authenticated user; this one is intentionally compact so it doesn't
// compete with the form on a small phone.
//
// Calls authApi.updateDeviceLanguage too, mirroring SettingsScreen so a
// parent who flips to Kurdish before logging in still gets push
// notifications in Kurdish after their session is established. The call
// only succeeds when authenticated, so we swallow the auth error on
// pre-login screens.

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function PreLoginLanguageSwitcher() {
  const colors = useColors();
  // useTranslation isn't used for translation here — we only need it
  // to subscribe to languageChanged so the pill text re-renders when
  // the user picks a new language from the sheet.
  useTranslation();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];

  const pick = async (code: string) => {
    setOpen(false);
    await changeLanguageAndApply(code);
    authApi.updateDeviceLanguage(code).catch(() => {});
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Language"
        onPress={() => setOpen(true)}
        style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Globe size={16} color={colors.textSecondary} />
        <Text style={[styles.pillText, { color: colors.text }]}>{current.label}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <FlatList
              data={LANGUAGES}
              keyExtractor={l => l.code}
              renderItem={({ item }) => {
                const selected = item.code === i18n.language;
                return (
                  <TouchableOpacity style={styles.row} onPress={() => pick(item.code)}>
                    <Text style={[styles.rowText, { color: colors.text }]}>{item.label}</Text>
                    {selected && <Check size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 12, right: 12, zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  pillText: { fontSize: font.sm, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: spacing.lg },
  sheet: { borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowText: { fontSize: font.md, fontWeight: '500' },
});
