import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, RefreshControl, Modal, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, User, X, Phone } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem {
  id: string; fullName: string; profilePicture?: string;
  classes?: { name: string };
  parents?: { fullName: string; phoneNumber: string };
}

export default function TeacherStudentsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<StudentItem | null>(null);

  useEffect(() => {
    teacherApi.getClasses().then(r => {
      setClasses(r.data || []);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const params: Record<string, string> = {};
    if (selectedClass) params.classId = selectedClass;
    if (search.trim()) params.search = search.trim();
    return teacherApi.getStudents(params)
      .then(r => setStudents(r.data || []))
      .catch(() => {});
  }, [selectedClass, search]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Students</Text>

        {/* Search */}
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search students..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><X size={16} color={colors.textMuted} /></TouchableOpacity> : null}
        </View>

        {/* Class filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <TouchableOpacity style={[styles.chip, !selectedClass && styles.chipActive]} onPress={() => setSelectedClass('')}>
            <Text style={[styles.chipText, !selectedClass && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {classes.map(c => (
            <TouchableOpacity key={c.id} style={[styles.chip, selectedClass === c.id && styles.chipActive]} onPress={() => setSelectedClass(c.id)}>
              <Text style={[styles.chipText, selectedClass === c.id && styles.chipTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : students.length === 0 ? (
          <View style={styles.empty}>
            <User size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No students found.</Text>
          </View>
        ) : (
          students.map(s => (
            <TouchableOpacity key={s.id} style={styles.studentCard} onPress={() => setSelected(s)}>
              {s.profilePicture ? (
                <Image source={{ uri: s.profilePicture }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>{s.fullName[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.studentName}>{s.fullName}</Text>
                {s.classes?.name && <Text style={styles.studentClass}>{s.classes.name}</Text>}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Student detail modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selected?.fullName}</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <X size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {selected?.classes?.name && (
              <View style={styles.modalBadge}>
                <Text style={styles.modalBadgeText}>{selected.classes.name}</Text>
              </View>
            )}
            {selected?.parents && (
              <View style={styles.parentCard}>
                <View style={styles.parentRow}>
                  <User size={14} color={colors.textMuted} />
                  <Text style={styles.parentLabel}>Parent:</Text>
                  <Text style={styles.parentValue}>{selected.parents.fullName}</Text>
                </View>
                {selected.parents.phoneNumber && (
                  <View style={styles.parentRow}>
                    <Phone size={14} color={colors.textMuted} />
                    <Text style={styles.parentLabel}>Phone:</Text>
                    <Text style={styles.parentValue}>{selected.parents.phoneNumber}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  list: { padding: spacing.md, paddingBottom: 40 },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  studentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  studentName: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  studentClass: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  modalBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: spacing.md },
  modalBadgeText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  parentCard: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  parentLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: '500' },
  parentValue: { fontSize: font.sm, color: colors.text, fontWeight: '600', flex: 1 },
});
