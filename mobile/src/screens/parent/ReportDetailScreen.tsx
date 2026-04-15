import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Report, ReportMark } from './ReportsScreen';

export default function ReportDetailScreen() {
  const route = useRoute<any>();
  const report: Report = route.params?.report;
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!report) return null;

  const dateStr = report.reportDate
    ? new Date(report.reportDate).toLocaleDateString()
    : new Date(report.createdAt).toLocaleDateString();

  const marks: ReportMark[] = report.marks && report.marks.length > 0
    ? report.marks
    : [
        ...(report.quizMarks != null ? [{ name: 'Quiz', value: report.quizMarks }] : []),
        ...(report.examMarks != null ? [{ name: 'Exam', value: report.examMarks }] : []),
      ];
  const marksTotal = marks.reduce((s, m) => s + (Number(m.value) || 0), 0);

  const sections: { label: string; value: string }[] = [];
  if (report.attendanceNotes) sections.push({ label: t('reports.attendance_notes'), value: report.attendanceNotes });
  if (report.behaviorNotes) sections.push({ label: t('reports.behavior_notes'), value: report.behaviorNotes });
  if (report.teacherNotes) sections.push({ label: t('reports.teacher_notes'), value: report.teacherNotes });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.iconBox}>
          <FileText size={24} color="#9333EA" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.subject}>{report.subject}</Text>
          {report.students?.fullName && (
            <Text style={styles.student}>{report.students.fullName}</Text>
          )}
        </View>
      </View>

      {/* Meta */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>{t('reports.report_date')}</Text>
        <Text style={styles.metaValue}>{dateStr}</Text>
      </View>

      {/* Marks */}
      {marks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('reports.marks', { defaultValue: 'Marks' })}</Text>
          <View style={styles.marksTable}>
            {marks.map((m, i) => (
              <View
                key={`${m.name}-${i}`}
                style={[styles.markRow, i < marks.length - 1 && styles.markRowBorder]}
              >
                <Text style={styles.markName}>{m.name}</Text>
                <Text style={styles.markValue}>{Number(m.value)}</Text>
              </View>
            ))}
            <View style={[styles.markRow, styles.markTotalRow]}>
              <Text style={styles.markTotalLabel}>
                {t('reports.total', { defaultValue: 'Total' })}
              </Text>
              <Text style={styles.markTotalValue}>{marksTotal}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Content sections */}
      {sections.length === 0 && marks.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t('reports.no_reports')}</Text>
        </View>
      ) : (
        sections.map(({ label, value }) => (
          <View key={label} style={styles.section}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <Text style={styles.sectionValue}>{value}</Text>
          </View>
        ))
      )}

      {/* Teacher */}
      {report.teachers?.fullName && (
        <Text style={styles.teacher}>{t('reports.by_teacher', { name: report.teachers.fullName })}</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  headerCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginBottom: spacing.md, ...shadow.sm,
  },
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: '#FAF5FF', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  subject: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  student: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md, paddingHorizontal: spacing.xs },
  metaLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  metaValue: { fontSize: font.sm, color: colors.text },
  section: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  sectionValue: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', ...shadow.sm },
  emptyText: { fontSize: font.md, color: colors.textMuted, fontStyle: 'italic' },
  teacher: { fontSize: font.sm, color: colors.textMuted, textAlign: 'right', marginTop: spacing.sm },
  marksTable: { marginTop: spacing.xs },
  markRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  markRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  markName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  markValue: { fontSize: font.md, fontWeight: '700', color: colors.text },
  markTotalRow: { marginTop: 4, borderTopWidth: 2, borderTopColor: colors.border, paddingTop: 10 },
  markTotalLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  markTotalValue: { fontSize: font.lg, fontWeight: '800', color: colors.primary },
});
