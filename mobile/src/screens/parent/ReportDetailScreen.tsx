import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Report } from './ReportsScreen';

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

  const sections: { label: string; value: string | number }[] = [];
  if (report.attendanceNotes) sections.push({ label: t('reports.attendance_notes'), value: report.attendanceNotes });
  if (report.behaviorNotes) sections.push({ label: t('reports.behavior_notes'), value: report.behaviorNotes });
  if (report.teacherNotes) sections.push({ label: t('reports.teacher_notes'), value: report.teacherNotes });
  if (report.quizMarks != null) sections.push({ label: t('reports.quiz_marks'), value: report.quizMarks });
  if (report.examMarks != null) sections.push({ label: t('reports.exam_marks'), value: report.examMarks });

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

      {/* Content sections */}
      {sections.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t('reports.no_reports')}</Text>
        </View>
      ) : (
        sections.map(({ label, value }) => (
          <View key={label} style={styles.section}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <Text style={styles.sectionValue}>{String(value)}</Text>
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
});
