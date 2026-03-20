import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GraduationCap, ChevronRight, Search } from 'lucide-react-native';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { spacing, radius, font, shadow } from '../../theme';
import i18n, { LANGUAGE_KEY } from '../../i18n';
import type { School } from '../../types';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'ku', label: 'KU' },
  { code: 'ar', label: 'AR' },
];

export default function SchoolPickerScreen() {
  const { t } = useTranslation();
  const { setSelectedSchool } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeLang, setActiveLang] = useState(i18n.language);

  useEffect(() => {
    authApi.getSchools()
      .then(r => setSchools(r.data || []))
      .catch(() => Alert.alert('Error', 'Could not load schools. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  const selectLanguage = async (code: string) => {
    setActiveLang(code);
    await i18n.changeLanguage(code);
    await AsyncStorage.setItem(LANGUAGE_KEY, code);
  };

  const filtered = useMemo(() =>
    query.trim() === '' ? schools : schools.filter(s => s.name.toLowerCase().includes(query.toLowerCase())),
    [schools, query]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {/* Language selector */}
        <View style={styles.langRow}>
          {LANGUAGES.map(lang => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langBtn, activeLang === lang.code && styles.langBtnActive]}
              onPress={() => selectLanguage(lang.code)}
              activeOpacity={0.7}
            >
              <Text style={[styles.langText, activeLang === lang.code && styles.langTextActive]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.logoBox}>
          <GraduationCap size={36} color="#fff" />
        </View>
        <Text style={styles.title}>{t('schoolpicker.title')}</Text>
        <Text style={styles.subtitle}>{t('schoolpicker.subtitle')}</Text>
      </View>

      {/* Card area */}
      <View style={[styles.card, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.cardTitle}>{t('schoolpicker.card_title')}</Text>

        {/* Search */}
        <View style={styles.searchBox}>
          <Search size={16} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder={t('schoolpicker.search')}
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>

        {loading ? (
          <ActivityIndicator color="#4F46E5" size="large" style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {query ? t('schoolpicker.no_match') : t('schoolpicker.no_schools')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={s => s.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: s }) => (
              <TouchableOpacity
                style={styles.schoolCard}
                onPress={() => setSelectedSchool(s)}
                activeOpacity={0.7}
              >
                <View style={styles.schoolIcon}>
                  <GraduationCap size={20} color="#4F46E5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.schoolName}>{s.name}</Text>
                </View>
                <ChevronRight size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#4F46E5' },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 36,
    paddingHorizontal: spacing.lg,
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignSelf: 'flex-end',
    marginBottom: spacing.md,
  },
  langBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  langBtnActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  langText: {
    fontSize: font.sm,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
  },
  langTextActive: {
    color: '#4F46E5',
  },
  logoBox: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  title: { fontSize: font.xxxl, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: font.sm, color: 'rgba(255,255,255,0.75)', marginTop: 8, textAlign: 'center' },
  card: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingTop: 24,
  },
  cardTitle: { fontSize: font.lg, fontWeight: '700', color: '#111827', marginBottom: spacing.md },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#fff', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: '#E5E7EB',
    ...shadow.sm,
  },
  searchInput: { flex: 1, fontSize: font.md, color: '#111827' },
  schoolCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#fff', borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  schoolIcon: {
    width: 42, height: 42, borderRadius: radius.sm,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
  },
  schoolName: { fontSize: font.md, fontWeight: '600', color: '#111827' },
  emptyBox: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: font.md, color: '#9CA3AF' },
});
