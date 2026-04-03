import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, Users } from 'lucide-react-native';
import { driverApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

export default function DriverStudentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    driverApi.getStudents()
      .then(r => setStudents(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = students.filter(s =>
    (s.fullName ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>{t('driver.students_title')}</Text>
      <Text style={styles.subtitle}>{t('driver.students_subtitle')}</Text>

      <View style={styles.searchBox}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('driver.search_students')}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {loading ? (
        <CardListSkeleton count={5} />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Users size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('driver.no_students')}</Text>
        </View>
      ) : (
        filtered.map(s => (
          <View key={s.id} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(s.fullName ?? '?').charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.fullName}</Text>
              {s.classes?.name && <Text style={styles.meta}>{s.classes.name}</Text>}
              {s.homeAddress && <Text style={styles.meta}>{s.homeAddress}</Text>}
              {((s.parents as any)?.residenceType || (s.parents as any)?.blockNumber) && (
                <Text style={styles.meta}>
                  {(s.parents as any).residenceType === 'apartment' ? 'Apartment' : (s.parents as any).residenceType === 'house' ? 'House' : ''}
                  {(s.parents as any).blockNumber ? ` · ${(s.parents as any).blockNumber}` : ''}
                </Text>
              )}
              {s.parents?.fullName && <Text style={styles.parent}>{s.parents.fullName}</Text>}
              {s.parents?.phoneNumber && <Text style={[styles.parent, { color: colors.primary }]}>{s.parents.phoneNumber}</Text>}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, marginBottom: spacing.md },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 2 },
  meta: { fontSize: font.sm, color: colors.textSecondary },
  parent: { fontSize: font.sm, color: colors.textSecondary, marginTop: 4, fontWeight: '500' },
});
