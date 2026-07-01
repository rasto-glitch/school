import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, TextInput, RefreshControl, Modal, Image, ActivityIndicator,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import HealthSafetyPanel, { type StudentHealthBrief } from '../../components/HealthSafetyPanel';
import { useTranslation } from 'react-i18next';
import { Search, User, X, FileText, Star } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem {
  id: string; fullName: string; profilePicture?: string;
  classes?: { name: string };
}

interface MarkRow { name: string; value: number }
interface ReportItem {
  id: string; subject: string;
  attendanceNotes?: string; behaviorNotes?: string; teacherNotes?: string;
  marks?: MarkRow[]; reportDate?: string; createdAt?: string;
}
interface GradeItem {
  id: string; subject: string;
  marks?: MarkRow[]; gradingPeriod?: string; academicYear?: string; createdAt?: string;
}
interface StudentBrief {
  student: StudentItem & { phoneNumber?: string; emergencyContact?: string; homeAddress?: string };
  reports: ReportItem[];
  grades: GradeItem[];
  health?: StudentHealthBrief | null;
}

function totalMarks(marks?: MarkRow[] | null): number {
  return (marks || []).reduce((s, m) => s + (Number(m.value) || 0), 0);
}

export default function TeacherStudentsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<StudentItem | null>(null);
  const [brief, setBrief] = useState<StudentBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  useEffect(() => {
    if (!selected) { setBrief(null); return; }
    setBriefLoading(true);
    setBrief(null);
    teacherApi.getStudentBrief(selected.id)
      .then(r => setBrief(r.data))
      .catch(() => setBrief(null))
      .finally(() => setBriefLoading(false));
  }, [selected]);

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
      <View style={[styles.header, { paddingTop: spacing.md }]}>
        <Text style={styles.title}>{t('nav.students')}</Text>

        {/* Search */}
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('driver.search_students')}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><X size={16} color={colors.textMuted} /></TouchableOpacity> : null}
        </View>

        {/* Class filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <TouchableOpacity style={[styles.chip, !selectedClass && styles.chipActive]} onPress={() => setSelectedClass('')}>
            <Text style={[styles.chipText, !selectedClass && styles.chipTextActive]}>{t('teacher.all')}</Text>
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
          <CardListSkeleton count={5} />
        ) : students.length === 0 ? (
          <View style={styles.empty}>
            <User size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('teacher.no_students_found')}</Text>
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
            {briefLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
            ) : brief && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
                {/* Basic info — no parent phone */}
                <View style={styles.infoCard}>
                  {brief.student.phoneNumber ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{t('bus.phone')}</Text>
                      <Text style={styles.infoValue}>{brief.student.phoneNumber}</Text>
                    </View>
                  ) : null}
                  {brief.student.emergencyContact ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{t('teacher.emergency')}</Text>
                      <Text style={styles.infoValue}>{brief.student.emergencyContact}</Text>
                    </View>
                  ) : null}
                  {brief.student.homeAddress ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{t('common.address')}</Text>
                      <Text style={styles.infoValue}>{brief.student.homeAddress}</Text>
                    </View>
                  ) : null}
                </View>

                <HealthSafetyPanel health={brief.health} />

                {/* Grades — this teacher's only */}
                <View style={styles.sectionHeader}>
                  <Star size={14} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('nav.grades')}</Text>
                  <Text style={styles.sectionCount}>({brief.grades.length})</Text>
                </View>
                {brief.grades.length === 0 ? (
                  <Text style={styles.emptyMini}>{t('past_records.no_grades')}</Text>
                ) : (
                  brief.grades.map(g => {
                    const tot = totalMarks(g.marks);
                    return (
                      <View key={g.id} style={styles.recordCard}>
                        <View style={styles.recordTop}>
                          <Text style={styles.recordTitle}>
                            {g.gradingPeriod || '—'}
                            {g.academicYear ? <Text style={styles.recordYear}>  {g.academicYear}</Text> : null}
                          </Text>
                          {tot > 0 && <Text style={styles.recordTotal}>{tot.toFixed(1)}</Text>}
                        </View>
                        {(g.marks || []).length > 0 && (
                          <View style={styles.markRow}>
                            {(g.marks || []).map((m, i) => (
                              <View key={i} style={styles.markPill}>
                                <Text style={styles.markPillText}>{m.name}: <Text style={styles.markPillVal}>{m.value}</Text></Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}

                {/* Reports — this teacher's only */}
                <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
                  <FileText size={14} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('nav.reports')}</Text>
                  <Text style={styles.sectionCount}>({brief.reports.length})</Text>
                </View>
                {brief.reports.length === 0 ? (
                  <Text style={styles.emptyMini}>{t('teacher.no_reports_submitted')}</Text>
                ) : (
                  brief.reports.map(r => (
                    <View key={r.id} style={styles.recordCard}>
                      <View style={styles.recordTop}>
                        <Text style={styles.recordTitle}>{r.subject}</Text>
                        <Text style={styles.recordYear}>{r.reportDate || (r.createdAt || '').slice(0, 10)}</Text>
                      </View>
                      {(r.marks || []).length > 0 && (
                        <View style={styles.markRow}>
                          {(r.marks || []).map((m, i) => (
                            <View key={i} style={styles.markPill}>
                              <Text style={styles.markPillText}>{m.name}: <Text style={styles.markPillVal}>{m.value}</Text></Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {r.attendanceNotes ? <Text style={styles.noteRow}><Text style={styles.noteLabel}>{t('teacher.note_attendance')}</Text>{r.attendanceNotes}</Text> : null}
                      {r.behaviorNotes ? <Text style={styles.noteRow}><Text style={styles.noteLabel}>{t('teacher.note_behavior')}</Text>{r.behaviorNotes}</Text> : null}
                      {r.teacherNotes ? <Text style={styles.noteRow}>{r.teacherNotes}</Text> : null}
                    </View>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  chip: {
    borderWidth: 1.5,
    borderColor: isDark ? '#FFFFFF' : colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm,
    backgroundColor: isDark ? 'transparent' : colors.card,
  },
  chipActive: {
    borderColor: isDark ? '#FFFFFF' : colors.primary,
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
  },
  chipText: { fontSize: font.sm, color: isDark ? '#FFFFFF' : colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: isDark ? '#000000' : colors.primary, fontWeight: '700' },
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
  infoCard: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.md },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  infoLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: font.sm, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  sectionTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  sectionCount: { fontSize: font.xs, color: colors.textMuted },
  emptyMini: { fontSize: font.sm, color: colors.textMuted, paddingVertical: spacing.sm },
  recordCard: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  recordTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recordTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text, flex: 1 },
  recordYear: { fontSize: font.xs, color: colors.textMuted, fontWeight: '500' },
  recordTotal: { fontSize: font.md, fontWeight: '800', color: colors.primary },
  markRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 },
  markPill: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  markPillText: { fontSize: font.xs, color: colors.textSecondary },
  markPillVal: { color: colors.text, fontWeight: '700' },
  noteRow: { fontSize: font.xs, color: colors.textSecondary, marginTop: 4 },
  noteLabel: { color: colors.textMuted, fontWeight: '600' },
});
