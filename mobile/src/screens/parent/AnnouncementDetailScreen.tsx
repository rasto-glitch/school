import { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Megaphone, Paperclip, FileText, Download, ExternalLink } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import type { Announcement } from '../../types';

interface LinkPreview {
  type: 'youtube' | 'link';
  videoId?: string;
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

function getAttachmentType(url: string): 'image' | 'pdf' | 'other' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export default function AnnouncementDetailScreen() {
  const route = useRoute<any>();
  const announcement: Announcement = route.params?.announcement;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    if (!announcement?.linkUrl) return;
    parentApi.getLinkPreview(announcement.linkUrl).then(r => setPreview(r.data)).catch(() => {});
  }, [announcement?.linkUrl]);

  if (!announcement) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
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

      {/* Link preview */}
      {announcement.linkUrl && (
        <View style={styles.linkCard}>
          <Text style={styles.sectionLabel}>Link</Text>
          {preview?.type === 'youtube' && preview.videoId ? (
            <TouchableOpacity style={styles.youtubeThumbnail} onPress={() => Linking.openURL(announcement.linkUrl!)}>
              <Image source={{ uri: `https://img.youtube.com/vi/${preview.videoId}/mqdefault.jpg` }} style={styles.youtubeImg} resizeMode="cover" />
              <View style={styles.playOverlay}>
                <View style={styles.playBtn}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </View>
              <View style={styles.ytBadge}>
                <Text style={styles.ytBadgeText}>YouTube</Text>
              </View>
            </TouchableOpacity>
          ) : preview && (preview.title || preview.image) ? (
            <TouchableOpacity style={styles.previewCard} activeOpacity={0.75} onPress={() => Linking.openURL(announcement.linkUrl!)}>
              {preview.image ? (
                <Image source={{ uri: preview.image }} style={styles.previewImage} resizeMode="cover" onError={() => {}} />
              ) : null}
              <View style={styles.previewBody}>
                {preview.siteName ? <Text style={styles.previewSite}>{preview.siteName}</Text> : null}
                {preview.title ? <Text style={styles.previewTitle} numberOfLines={2}>{preview.title}</Text> : null}
                {preview.description ? <Text style={styles.previewDesc} numberOfLines={2}>{preview.description}</Text> : null}
                <View style={styles.openRow}>
                  <ExternalLink size={12} color={colors.primary} />
                  <Text style={styles.openText}>Open link</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(announcement.linkUrl!)}>
              <ExternalLink size={15} color={colors.primary} />
              <Text style={styles.attachText}>Open Link</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Attachment */}
      {announcement.attachmentUrl && (() => {
        const type = getAttachmentType(announcement.attachmentUrl!);
        return (
          <View style={styles.attachCard}>
            <Text style={styles.sectionLabel}>Attachment</Text>
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
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  heroLabel: { fontSize: font.sm, color: 'rgba(255,255,255,0.8)', fontWeight: '500', flex: 1 },
  audienceBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  audienceBadgeText: { fontSize: font.xs, color: '#fff', fontWeight: '600' },
  heroTitle: { fontSize: font.xl, fontWeight: '800', color: '#fff', marginBottom: spacing.sm },
  heroDate: { fontSize: font.xs, color: 'rgba(255,255,255,0.6)' },
  contentCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  contentText: { fontSize: font.md, color: colors.text, lineHeight: 24 },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  // Link preview
  linkCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  youtubeThumbnail: { borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  youtubeImg: { width: '100%', height: 180 },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 20, marginLeft: 3 },
  ytBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  ytBadgeText: { fontSize: font.xs, color: '#fff', fontWeight: '700' },
  previewCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  previewImage: { width: '100%', height: 140 },
  previewBody: { padding: spacing.sm },
  previewSite: { fontSize: font.xs, color: colors.textMuted, marginBottom: 3 },
  previewTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: 3 },
  previewDesc: { fontSize: font.xs, color: colors.textSecondary, lineHeight: 17 },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  openText: { fontSize: font.xs, color: colors.primary, fontWeight: '600' },
  // Attachment
  attachCard: { marginBottom: spacing.md },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.sm, alignSelf: 'flex-start' },
  attachText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  attachImage: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.border, marginBottom: spacing.sm },
  pdfCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md },
  pdfLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  pdfSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
});
