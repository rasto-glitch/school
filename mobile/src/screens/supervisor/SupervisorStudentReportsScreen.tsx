import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, TextInput,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import HealthSafetyPanel, { type StudentHealthBrief } from '../../components/HealthSafetyPanel';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, FileText, ChevronDown, ChevronUp } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface Student {
  id: string;
  fullName: string;
  classes?: { name: string };
}

interface Grade {
  id: string;
  subject: string;
  gradingPeriod?: string;
  academicYear?: string;
  dailyGrade?: number;
  quizGrade?: number;
  monthlyExamGrade?: number;
  termExamGrade?: number;
}

interface Report {
  id: string;
  subject: string;
  reportDate?: string;
  attendanceNotes?: string;
  behaviorNotes?: string;
  quizMarks?: number;
  examMarks?: number;
  teacherNotes?: string;
}

export default function SupervisorStudentReportsScreen({ embedded = false }: { embedded?: boolean }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<Student | null>(null);
  const [brief, setBrief] = useState<{ student: any; reports: Report[]; grades: Grade[]; health?: StudentHealthBrief | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'grades' | 'reports' | null>('grades');

  useEffect(() => {
    supervisorApi.getAllStudents()
      .then(r => setStudents(r.data?.students || r.data || []))
      .catch(() => {});
  }, []);

  const filtered = query.trim()
    ? students.filter(s => s.fullName.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  const selectStudent = (s: Student) => {
    setSelected(s);
    setQuery(s.fullName);
    setShowDropdown(false);
    setLoading(true);
    setBrief(null);
    supervisorApi.getStudentBrief(s.id)
      .then(r => setBrief(r.data))
      .finally(() => setLoading(false));
  };

  // Group grades by period
  const grades = brief?.grades || [];
  const byPeriod: Record<string, Grade[]> = {};
  grades.forEach(g => {
    const p = g.gradingPeriod || t('supervisor.unknown');
    if (!byPeriod[p]) byPeriod[p] = [];
    byPeriod[p].push(g);
  });
  const periods = Object.keys(byPeriod).sort();
  const subjects = [...new Set(grades.map(g => g.subject))].sort();

  const student = brief?.student;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: embedded ? spacing.md : insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      {!embedded && <Text style={styles.title}>{t('supervisor.student_reports')}</Text>}

      {/* Search */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('supervisor.type_student_name')}
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={txt => { setQuery(txt); setShowDropdown(true); }}
            onFocus={() => { if (query) setShowDropdown(true); }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setSelected(null); setBrief(null); setShowDropdown(false); }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        {showDropdown && filtered.length > 0 && (
          <View style={styles.dropdown}>
            {filtered.map(s => (
              <TouchableOpacity key={s.id} style={styles.dropdownItem} onPress={() => selectStudent(s)}>
                <View style={styles.dropdownAvatar}>
                  <Text style={styles.dropdownAvatarText}>{s.fullName[0]}</Text>
                </View>
                <View>
                  <Text style={styles.dropdownName}>{s.fullName}</Text>
                  {s.classes?.name && <Text style={styles.dropdownClass}>{s.classes.name}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {!selected && !loading && (
        <View style={styles.emptyCard}>
          <FileText size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('supervisor.search_above')}</Text>
        </View>
      )}

      {loading && <CardListSkeleton count={4} />}

      {brief && student && (
        <>
          {/* Student info card */}
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{(student.fullName || student.full_name || '?')[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{student.fullName || student.full_name}</Text>
              <Text style={styles.profileMeta}>
                {[student.classes?.name, student.parents?.fullName || student.parents?.full_name].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>

          <HealthSafetyPanel health={brief.health} />

          {/* Grades section */}
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setExpandedSection(expandedSection === 'grades' ? null : 'grades')}
          >
            <Text style={styles.sectionTitle}>{t('nav.grades')}</Text>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionCount}>{t('supervisor.n_records', { count: grades.length })}</Text>
              {expandedSection === 'grades' ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'grades' && (
            grades.length === 0 ? (
              <View style={styles.emptySection}><Text style={styles.emptySectionText}>{t('past_records.no_grades')}</Text></View>
            ) : (
              periods.map(period => (
                <View key={period} style={styles.periodCard}>
                  <Text style={styles.periodLabel}>{period}</Text>
                  {subjects.map(subj => {
                    const g = byPeriod[period]?.find(r => r.subject === subj);
                    if (!g) return null;
                    const total = (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0);
                    return (
                      <View key={subj} style={styles.gradeRow}>
                        <Text style={styles.gradeSubject}>{subj}</Text>
                        <View style={styles.gradeScores}>
                          {([[t('supervisor.abbr_daily'), g.dailyGrade], [t('supervisor.abbr_quiz'), g.quizGrade], [t('supervisor.abbr_monthly'), g.monthlyExamGrade], [t('supervisor.abbr_term'), g.termExamGrade]] as [string, number | undefined][]).map(([lbl, val]) => (
                            val != null ? (
                              <View key={lbl} style={styles.scoreBox}>
                                <Text style={styles.scoreLabel}>{lbl}</Text>
                                <Text style={styles.scoreValue}>{val}</Text>
                              </View>
                            ) : null
                          ))}
                          <View style={[styles.scoreBox, { backgroundColor: colors.primaryLight }]}>
                            <Text style={[styles.scoreLabel, { color: colors.primary }]}>{t('grades.total')}</Text>
                            <Text style={[styles.scoreValue, { color: colors.primary, fontWeight: '800' }]}>{total.toFixed(0)}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )
          )}

          {/* Reports section */}
          <TouchableOpacity
            style={[styles.sectionHeader, { marginTop: spacing.sm }]}
            onPress={() => setExpandedSection(expandedSection === 'reports' ? null : 'reports')}
          >
            <Text style={styles.sectionTitle}>{t('nav.reports')}</Text>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionCount}>{t('supervisor.n_reports', { count: brief.reports.length })}</Text>
              {expandedSection === 'reports' ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
            </View>
          </TouchableOpacity>

          {expandedSection === 'reports' && (
            brief.reports.length === 0 ? (
              <View style={styles.emptySection}><Text style={styles.emptySectionText}>{t('supervisor.no_reports_available')}</Text></View>
            ) : (
              brief.reports.map(r => (
                <View key={r.id} style={styles.reportCard}>
                  <View style={styles.reportHeader}>
                    <Text style={styles.reportSubject}>{r.subject}</Text>
                    {r.reportDate && <Text style={styles.reportDate}>{new Date(r.reportDate).toLocaleDateString()}</Text>}
                  </View>
                  {r.attendanceNotes && <Text style={styles.reportNote}><Text style={styles.noteLabel}>{t('teacher.note_attendance')}</Text>{r.attendanceNotes}</Text>}
                  {r.behaviorNotes && <Text style={styles.reportNote}><Text style={styles.noteLabel}>{t('teacher.note_behavior')}</Text>{r.behaviorNotes}</Text>}
                  <View style={styles.marksRow}>
                    {r.quizMarks != null && (
                      <View style={[styles.markBox, { backgroundColor: '#EFF6FF' }]}>
                        <Text style={[styles.markLabel, { color: '#2563EB' }]}>{t('grades.quiz')}</Text>
                        <Text style={[styles.markValue, { color: '#2563EB' }]}>{r.quizMarks}</Text>
                      </View>
                    )}
                    {r.examMarks != null && (
                      <View style={[styles.markBox, { backgroundColor: '#F0FDF4' }]}>
                        <Text style={[styles.markLabel, { color: '#16A34A' }]}>{t('supervisor.exam')}</Text>
                        <Text style={[styles.markValue, { color: '#16A34A' }]}>{r.examMarks}</Text>
                      </View>
                    )}
                  </View>
                  {r.teacherNotes && (
                    <View style={styles.teacherNotesBox}>
                      <Text style={styles.noteLabel}>{t('reports.teacher_notes')}</Text>
                      <Text style={styles.reportNote}>{r.teacherNotes}</Text>
                    </View>
                  )}
                </View>
              ))
            )
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 60 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  searchWrapper: { position: 'relative', zIndex: 10, marginBottom: spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, ...shadow.sm },
  searchInput: { flex: 1, fontSize: font.sm, color: colors.text },
  clearBtn: { fontSize: font.sm, color: colors.textMuted, paddingHorizontal: 4 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: colors.card, borderRadius: radius.md, marginTop: 4, ...shadow.md, overflow: 'hidden' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  dropdownAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  dropdownAvatarText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  dropdownName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  dropdownClass: { fontSize: font.xs, color: colors.textMuted },
  emptyCard: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, ...shadow.sm },
  profileAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { fontSize: font.xl, fontWeight: '800', color: colors.primary },
  profileName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  profileMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionCount: { fontSize: font.xs, color: colors.textMuted },
  emptySection: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.sm },
  emptySectionText: { fontSize: font.sm, color: colors.textMuted },
  periodCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  periodLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  gradeRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.borderLight },
  gradeSubject: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 4 },
  gradeScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scoreBox: { backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', minWidth: 44 },
  scoreLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  scoreValue: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  reportCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  reportSubject: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  reportDate: { fontSize: font.xs, color: colors.textMuted },
  reportNote: { fontSize: font.sm, color: colors.textSecondary, marginBottom: 4 },
  noteLabel: { fontWeight: '700', color: colors.text },
  marksRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
  markBox: { flex: 1, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  markLabel: { fontSize: font.xs, fontWeight: '600' },
  markValue: { fontSize: font.xl, fontWeight: '800' },
  teacherNotesBox: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs },
});
