import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { BookOpen, Calendar, Paperclip } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Homework } from '../../types';

export default function HomeworkDetailScreen() {
  const route = useRoute<any>();
  const homework: Homework = route.params?.homework;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!homework) return null;

  const overdue = homework.dueDate ? new Date(homework.dueDate) < new Date() : false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.iconBox}>
          <BookOpen size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleText}>{homework.title}</Text>
          <View style={styles.badgeRow}>
            {homework.subject && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{homework.subject}</Text>
              </View>
            )}
            {homework.classes?.name && (
              <View style={[styles.badge, styles.badgeSecondary]}>
                <Text style={[styles.badgeText, styles.badgeTextSecondary]}>{homework.classes.name}</Text>
              </View>
            )}
            {overdue && (
              <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                <Text style={[styles.badgeText, { color: colors.danger }]}>Overdue</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Due date */}
      {homework.dueDate && (
        <View style={styles.metaCard}>
          <Calendar size={16} color={overdue ? colors.danger : colors.textMuted} />
          <Text style={styles.metaLabel}>Due date</Text>
          <Text style={[styles.metaValue, overdue && { color: colors.danger, fontWeight: '600' }]}>
            {new Date(homework.dueDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Text>
        </View>
      )}

      {/* Description */}
      {homework.description && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.sectionValue}>{homework.description}</Text>
        </View>
      )}

      {/* Attachment */}
      {homework.attachmentUrl && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Attachment</Text>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => Linking.openURL(homework.attachmentUrl!)}
          >
            <Paperclip size={16} color={colors.primary} />
            <Text style={styles.attachText}>Download Attachment</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.posted}>
        Posted {new Date(homework.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  titleText: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: 6 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  badgeSecondary: { backgroundColor: colors.border },
  badgeTextSecondary: { color: colors.textSecondary },
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
  posted: { fontSize: font.xs, color: colors.textMuted, textAlign: 'right', marginTop: spacing.sm },
});
