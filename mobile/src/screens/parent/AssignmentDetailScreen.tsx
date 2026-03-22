import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { ClipboardList, Calendar, Paperclip, FileText, Download } from 'lucide-react-native';

function getAttachmentType(url: string): 'image' | 'pdf' | 'other' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';

interface Assignment {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  dueDate?: string;
  submissionStatus?: string;
  grade?: number | null;
  attachmentUrl?: string;
  createdAt: string;
  classes?: { name: string };
  students?: { fullName: string };
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:   { bg: '#FEF9C3', text: '#A16207' },
  submitted: { bg: '#F3F4F6', text: '#374151' },
  graded:    { bg: '#DCFCE7', text: '#15803D' },
};

export default function AssignmentDetailScreen() {
  const route = useRoute<any>();
  const assignment: Assignment = route.params?.assignment;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!assignment) return null;

  const statusStyle = STATUS_COLORS[assignment.submissionStatus ?? ''] ?? { bg: colors.border, text: colors.textSecondary };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.iconBox}>
          <ClipboardList size={24} color="#16A34A" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleText}>{assignment.title}</Text>
          <View style={styles.badgeRow}>
            {assignment.subject && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{assignment.subject}</Text>
              </View>
            )}
            {assignment.classes?.name && (
              <View style={[styles.badge, styles.badgeSecondary]}>
                <Text style={[styles.badgeText, styles.badgeTextSecondary]}>{assignment.classes.name}</Text>
              </View>
            )}
            {assignment.submissionStatus && (
              <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
                <Text style={[styles.badgeText, { color: statusStyle.text }]}>{assignment.submissionStatus}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Grade */}
      {assignment.grade != null && (
        <View style={styles.gradeCard}>
          <Text style={styles.gradeLabel}>Grade</Text>
          <Text style={styles.gradeValue}>{assignment.grade}</Text>
        </View>
      )}

      {/* Due date */}
      {assignment.dueDate && (
        <View style={styles.metaCard}>
          <Calendar size={16} color={colors.textMuted} />
          <Text style={styles.metaLabel}>Due date</Text>
          <Text style={styles.metaValue}>
            {new Date(assignment.dueDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Text>
        </View>
      )}

      {/* Description */}
      {assignment.description && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.sectionValue}>{assignment.description}</Text>
        </View>
      )}

      {/* Attachment */}
      {assignment.attachmentUrl && (() => {
        const type = getAttachmentType(assignment.attachmentUrl!);
        return (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Attachment</Text>
            {type === 'image' ? (
              <>
                <Image source={{ uri: assignment.attachmentUrl }} style={styles.attachImage} resizeMode="contain" />
                <TouchableOpacity style={[styles.attachBtn, { marginTop: spacing.sm }]} onPress={() => Linking.openURL(assignment.attachmentUrl!)}>
                  <Download size={15} color={colors.primary} />
                  <Text style={styles.attachText}>Download</Text>
                </TouchableOpacity>
              </>
            ) : type === 'pdf' ? (
              <View style={styles.pdfCard}>
                <FileText size={32} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pdfLabel}>PDF Document</Text>
                  <Text style={styles.pdfSub}>Tap to open in viewer</Text>
                </View>
                <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(assignment.attachmentUrl!)}>
                  <Download size={15} color={colors.primary} />
                  <Text style={styles.attachText}>Open</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(assignment.attachmentUrl!)}>
                <Paperclip size={16} color={colors.primary} />
                <Text style={styles.attachText}>Download Attachment</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      {/* Student */}
      {assignment.students?.fullName && (
        <Text style={styles.student}>Student: {assignment.students.fullName}</Text>
      )}
      <Text style={styles.posted}>
        Posted {new Date(assignment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>
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
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  titleText: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: 6 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { backgroundColor: '#DCFCE7', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '700', color: '#16A34A' },
  badgeSecondary: { backgroundColor: colors.border },
  badgeTextSecondary: { color: colors.textSecondary },
  gradeCard: {
    backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', marginBottom: spacing.md, ...shadow.sm,
  },
  gradeLabel: { fontSize: font.sm, color: colors.textMuted, marginBottom: 4 },
  gradeValue: { fontSize: 40, fontWeight: '800', color: colors.primary },
  metaCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.md, ...shadow.sm,
  },
  metaLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  metaValue: { flex: 1, fontSize: font.sm, color: colors.text, textAlign: 'right' },
  section: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  sectionValue: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.sm, alignSelf: 'flex-start' },
  attachText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  attachImage: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  pdfCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md },
  pdfLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  pdfSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  student: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.sm },
  posted: { fontSize: font.xs, color: colors.textMuted, textAlign: 'right', marginTop: spacing.xs },
});
