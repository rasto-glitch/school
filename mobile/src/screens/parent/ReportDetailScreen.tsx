import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { FileText } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';

interface Report {
  id: string;
  title?: string;
  content?: string;
  subject?: string;
  createdAt: string;
  students?: { fullName: string };
  teachers?: { fullName: string };
}

export default function ReportDetailScreen() {
  const route = useRoute<any>();
  const report: Report = route.params?.report;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!report) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.iconBox}>
          <FileText size={24} color="#9333EA" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{report.title || 'Report'}</Text>
          {report.students?.fullName && (
            <Text style={styles.student}>{report.students.fullName}</Text>
          )}
        </View>
      </View>

      {/* Meta row */}
      <View style={styles.metaRow}>
        {report.subject && (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{report.subject}</Text>
          </View>
        )}
        <Text style={styles.date}>{new Date(report.createdAt).toLocaleDateString()}</Text>
      </View>

      {/* Content */}
      {report.content ? (
        <View style={styles.contentCard}>
          <Text style={styles.contentText}>{report.content}</Text>
        </View>
      ) : (
        <View style={styles.contentCard}>
          <Text style={styles.emptyContent}>No content available.</Text>
        </View>
      )}

      {/* Teacher */}
      {report.teachers?.fullName && (
        <Text style={styles.teacher}>Written by {report.teachers.fullName}</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  headerCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm, ...shadow.sm },
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: '#FAF5FF', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  student: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  tag: { backgroundColor: '#F3E8FF', borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontSize: font.xs, color: '#7C3AED', fontWeight: '600' },
  date: { fontSize: font.xs, color: colors.textMuted },
  contentCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  contentText: { fontSize: font.md, color: colors.text, lineHeight: 24 },
  emptyContent: { fontSize: font.md, color: colors.textMuted, fontStyle: 'italic' },
  teacher: { fontSize: font.sm, color: colors.textMuted, textAlign: 'right', marginTop: spacing.xs },
});
