import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Megaphone, Paperclip, FileText, Download } from 'lucide-react-native';

function getAttachmentType(url: string): 'image' | 'pdf' | 'other' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import type { Announcement } from '../../types';

export default function AnnouncementDetailScreen() {
  const route = useRoute<any>();
  const announcement: Announcement = route.params?.announcement;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!announcement) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Gradient-style header */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Megaphone size={18} color="rgba(255,255,255,0.8)" />
          <Text style={styles.heroLabel}>School Announcement</Text>
          {announcement.targetAudience && (
            <View style={styles.audienceBadge}>
              <Text style={styles.audienceBadgeText}>{announcement.targetAudience}</Text>
            </View>
          )}
        </View>
        <Text style={styles.heroTitle}>{announcement.title}</Text>
        <Text style={styles.heroDate}>
          {new Date(announcement.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.contentCard}>
        <Text style={styles.contentText}>{announcement.content}</Text>
      </View>

      {/* Attachment */}
      {announcement.attachmentUrl && (() => {
        const type = getAttachmentType(announcement.attachmentUrl!);
        return (
          <View style={styles.attachCard}>
            {type === 'image' ? (
              <>
                <Image source={{ uri: announcement.attachmentUrl }} style={styles.attachImage} resizeMode="contain" />
                <TouchableOpacity style={[styles.attachBtn, { marginTop: spacing.sm }]} onPress={() => Linking.openURL(announcement.attachmentUrl!)}>
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
                <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(announcement.attachmentUrl!)}>
                  <Download size={15} color={colors.primary} />
                  <Text style={styles.attachText}>Open</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(announcement.attachmentUrl!)}>
                <Paperclip size={16} color={colors.primary} />
                <Text style={styles.attachText}>Download Attachment</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  heroCard: {
    backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  heroLabel: { fontSize: font.sm, color: 'rgba(255,255,255,0.8)', fontWeight: '500', flex: 1 },
  audienceBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  audienceBadgeText: { fontSize: font.xs, color: '#fff', fontWeight: '600' },
  heroTitle: { fontSize: font.xl, fontWeight: '800', color: '#fff', marginBottom: spacing.sm },
  heroDate: { fontSize: font.xs, color: 'rgba(255,255,255,0.6)' },
  contentCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md },
  contentText: { fontSize: font.md, color: colors.text, lineHeight: 24 },
  attachCard: { marginTop: spacing.md },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.sm, alignSelf: 'flex-start' },
  attachText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  attachImage: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  pdfCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md },
  pdfLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  pdfSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
});
