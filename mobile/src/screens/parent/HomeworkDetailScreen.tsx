import { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute } from '@react-navigation/native';
import { BookOpen, Calendar, Paperclip, FileText, Download } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Homework } from '../../types';
import ImageViewerModal from '../../components/ImageViewerModal';
import { downloadAttachment } from '../../utils/download';

function getAttachmentType(url: string): 'image' | 'pdf' | 'other' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export default function HomeworkDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const homework: Homework = route.params?.homework;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!homework) return null;

  const overdue = homework.dueDate ? new Date(homework.dueDate) < new Date() : false;

  const handleDownload = async () => {
    if (!homework.attachmentUrl || downloading) return;
    setDownloading(true);
    try { await downloadAttachment(homework.attachmentUrl); } finally { setDownloading(false); }
  };

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
                <Text style={[styles.badgeText, { color: colors.danger }]}>{t('common.overdue')}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Due date */}
      {homework.dueDate && (
        <View style={styles.metaCard}>
          <Calendar size={16} color={overdue ? colors.danger : colors.textMuted} />
          <Text style={styles.metaLabel}>{t('detail.due_date')}</Text>
          <Text style={[styles.metaValue, overdue && { color: colors.danger, fontWeight: '600' }]}>
            {new Date(homework.dueDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Text>
        </View>
      )}

      {/* Description */}
      {homework.description && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('detail.description')}</Text>
          <Text style={styles.sectionValue}>{homework.description}</Text>
        </View>
      )}

      {/* Attachment */}
      {homework.attachmentUrl && (() => {
        const type = getAttachmentType(homework.attachmentUrl);
        return (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('detail.attachment')}</Text>
            {type === 'image' ? (
              <>
                <TouchableOpacity activeOpacity={0.9} onPress={() => setViewerOpen(true)}>
                  <Image
                    source={{ uri: homework.attachmentUrl }}
                    style={styles.attachImage}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachBtn, { marginTop: spacing.sm }]}
                  onPress={handleDownload}
                  disabled={downloading}
                >
                  <Download size={15} color={colors.primary} />
                  <Text style={styles.attachText}>{downloading ? t('detail.downloading') : t('detail.download')}</Text>
                </TouchableOpacity>
              </>
            ) : type === 'pdf' ? (
              <View style={styles.pdfCard}>
                <FileText size={32} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pdfLabel}>{t('detail.pdf_document')}</Text>
                  <Text style={styles.pdfSub}>{t('detail.tap_to_open_viewer')}</Text>
                </View>
                <TouchableOpacity style={styles.attachBtn} onPress={() => Linking.openURL(homework.attachmentUrl!)}>
                  <Download size={15} color={colors.primary} />
                  <Text style={styles.attachText}>{t('detail.open')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.attachBtn} onPress={handleDownload} disabled={downloading}>
                <Paperclip size={16} color={colors.primary} />
                <Text style={styles.attachText}>{downloading ? t('detail.downloading') : t('detail.download_attachment')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      <Text style={styles.posted}>
        {t('detail.posted', { date: new Date(homework.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) })}
      </Text>

      <ImageViewerModal
        visible={viewerOpen}
        uri={homework.attachmentUrl ?? null}
        onClose={() => setViewerOpen(false)}
        onDownload={handleDownload}
        downloading={downloading}
      />
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
  attachImage: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  pdfCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md },
  pdfLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  pdfSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  posted: { fontSize: font.xs, color: colors.textMuted, textAlign: 'right', marginTop: spacing.sm },
});
