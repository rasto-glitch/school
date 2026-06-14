import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Globe } from 'lucide-react-native';
import i18n, { changeLanguageAndApply } from '../../i18n';
import { authApi } from '../../services/api';
import { useColors, useThemeStore } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

// Language pills (EN / AR / KU) + persistence. Shared across all role
// settings screens so the picker looks and behaves identically everywhere.
export default function LanguageSelector({ label }: { label: string }) {
  const colors = useColors();
  const isDark = useThemeStore(s => s.isDark);
  const [lang, setLang] = useState(i18n.language || 'en');

  useEffect(() => {
    const h = (l: string) => setLang(l);
    i18n.on('languageChanged', h);
    return () => { i18n.off('languageChanged', h); };
  }, []);

  const change = (code: string) => {
    setLang(code);
    changeLanguageAndApply(code);
    authApi.updateDeviceLanguage(code).catch(() => {});
  };

  const s = makeStyles(colors, isDark);
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={[s.iconBox, isDark ? { borderWidth: 1.5, borderColor: '#FFFFFF' } : { backgroundColor: colors.primaryLight }]}>
          <Globe size={18} color={isDark ? '#FFFFFF' : colors.primary} />
        </View>
        <Text style={s.label}>{label}</Text>
      </View>
      <View style={s.row}>
        {LANGUAGES.map(l => (
          <TouchableOpacity key={l.code} style={[s.btn, lang === l.code && s.btnActive]} onPress={() => change(l.code)}>
            <Text style={[s.btnText, lang === l.code && s.btnTextActive]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>, isDark: boolean) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: 2, ...shadow.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBox: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.md, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1.5,
    borderColor: isDark ? '#FFFFFF' : colors.border, alignItems: 'center',
    backgroundColor: isDark ? 'transparent' : colors.bg,
  },
  btnActive: { borderColor: isDark ? '#FFFFFF' : colors.primary, backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight },
  btnText: { fontSize: font.sm, fontWeight: '600', color: isDark ? '#FFFFFF' : colors.textSecondary },
  btnTextActive: { color: isDark ? '#000000' : colors.primary },
});
