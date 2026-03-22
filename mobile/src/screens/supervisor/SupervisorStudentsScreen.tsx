import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, Linking, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, Phone, MapPin, Home, Building2 } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface StudentItem {
  id: string;
  fullName: string;
  classes?: { id: string; name: string; gradeLevel?: string };
  parents?: {
    fullName?: string;
    phoneNumber?: string;
    residenceType?: 'apartment' | 'house';
    blockNumber?: string;
    latitude?: number;
    longitude?: number;
  };
}

export default function SupervisorStudentsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const r = await supervisorApi.getAllStudents();
    setStudents(r.data || []);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  // Filter by search
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return students;
    return students.filter(s =>
      s.fullName.toLowerCase().includes(q) ||
      s.classes?.name.toLowerCase().includes(q) ||
      s.parents?.fullName?.toLowerCase().includes(q)
    );
  }, [students, search]);

  // Group by class
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; grade?: string; items: StudentItem[] }>();
    filtered.forEach(s => {
      const key = s.classes?.id ?? 'unassigned';
      const label = s.classes?.name ?? 'Unassigned';
      const grade = s.classes?.gradeLevel;
      if (!map.has(key)) map.set(key, { label, grade, items: [] });
      map.get(key)!.items.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered]);

  const callParent = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>{t('nav.students', 'Students')}</Text>

      {/* Search */}
      <View style={styles.searchBox}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search students or parents..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : grouped.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No students found.</Text>
        </View>
      ) : (
        grouped.map(group => (
          <View key={group.label}>
            {/* Group header */}
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{group.label}</Text>
              {group.grade && <Text style={styles.groupGrade}>{group.grade}</Text>}
              <Text style={styles.groupCount}>{group.items.length} students</Text>
            </View>

            {group.items.map(student => {
              const parent = student.parents;
              const hasLocation = (parent?.latitude != null && parent?.longitude != null);
              return (
                <View key={student.id} style={styles.card}>
                  {/* Student name */}
                  <Text style={styles.studentName}>{student.fullName}</Text>

                  {/* Parent info */}
                  {parent?.fullName ? (
                    <View style={styles.parentRow}>
                      <Text style={styles.parentLabel}>Parent</Text>
                      <Text style={styles.parentName}>{parent.fullName}</Text>
                    </View>
                  ) : null}

                  {/* Phone + call button */}
                  {parent?.phoneNumber ? (
                    <View style={styles.infoRow}>
                      <Phone size={13} color={colors.textMuted} />
                      <Text style={styles.infoText}>{parent.phoneNumber}</Text>
                      <TouchableOpacity style={styles.callBtn} onPress={() => callParent(parent.phoneNumber!)}>
                        <Text style={styles.callBtnText}>Call</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {/* Residence */}
                  {(parent?.residenceType || parent?.blockNumber) ? (
                    <View style={styles.infoRow}>
                      {parent.residenceType === 'apartment'
                        ? <Building2 size={13} color={colors.textMuted} />
                        : <Home size={13} color={colors.textMuted} />}
                      <Text style={styles.infoText}>
                        {parent.residenceType === 'apartment' ? 'Apartment' : parent.residenceType === 'house' ? 'House' : ''}
                        {parent.blockNumber ? ` · ${parent.blockNumber}` : ''}
                      </Text>
                    </View>
                  ) : null}

                  {/* Location status */}
                  <View style={styles.infoRow}>
                    <MapPin size={13} color={hasLocation ? colors.success : colors.textMuted} />
                    <Text style={[styles.infoText, { color: hasLocation ? colors.success : colors.textMuted }]}>
                      {hasLocation ? 'Pickup location set' : 'No pickup location'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: font.sm, color: colors.text },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  groupTitle: { fontSize: font.sm, fontWeight: '800', color: colors.text },
  groupGrade: { fontSize: font.xs, color: colors.primary, fontWeight: '600', backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  groupCount: { fontSize: font.xs, color: colors.textMuted, marginLeft: 'auto' },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm,
    gap: 6,
  },
  studentName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  parentLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  parentName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { fontSize: font.xs, color: colors.textSecondary, flex: 1 },
  callBtn: {
    backgroundColor: colors.successLight, borderRadius: radius.full,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  callBtnText: { fontSize: 11, fontWeight: '700', color: colors.success },
});
