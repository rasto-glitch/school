import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Megaphone, BookOpen, FileText, ClipboardList, MapPin, Bell, Calendar, Star } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';
import { useColors } from '../../store/themeStore';
import type { Homework, Announcement } from '../../types';

interface Grade {
  id: string;
  subject?: string;
  grade?: number;
  maxGrade?: number;
  students?: { fullName: string };
}

type FeedItem =
  | { type: 'announcement'; date: string; data: Announcement }
  | { type: 'homework'; date: string; data: Homework };

function timeLabel(dateStr: string): string {
  const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

export default function FeedScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [hw, ann, gr] = await Promise.allSettled([
      parentApi.getHomework(),
      parentApi.getAnnouncements(),
      parentApi.getGrades(),
    ]);
    if (hw.status === 'fulfilled') setHomework(hw.value.data || []);
    if (ann.status === 'fulfilled') setAnnouncements(ann.value.data || []);
    if (gr.status === 'fulfilled') setGrades((gr.value.data || []).slice(0, 3));
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  const feedItems: FeedItem[] = [
    ...announcements.map(a => ({ type: 'announcement' as const, date: a.createdAt, data: a })),
    ...homework.map(h => ({ type: 'homework' as const, date: h.createdAt, data: h })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const shortcuts = [
    { label: t('dashboard.quick_homework'), icon: BookOpen, bg: '#EFF6FF', iconColor: '#2563EB', tab: 'Homework' },
    { label: t('dashboard.quick_assignments'), icon: ClipboardList, bg: '#F0FDF4', iconColor: '#16A34A', tab: 'Assignments' },
    { label: t('dashboard.quick_bus'), icon: MapPin, bg: '#FFFBEB', iconColor: '#D97706', tab: 'BusTracking' },
    { label: t('dashboard.quick_alerts'), icon: Bell, bg: '#FFF1F2', iconColor: '#E11D48', tab: 'Notifications' },
    { label: t('dashboard.quick_reports', 'Reports'), icon: FileText, bg: '#FAF5FF', iconColor: '#9333EA', tab: 'Reports' },
    { label: t('dashboard.quick_bookings', 'Bookings'), icon: Calendar, bg: '#F0FDFA', iconColor: '#0D9488', tab: 'Appointments' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('dashboard.subtitle', { name: user?.firstName })}</Text>
        <Text style={styles.title}>{t('dashboard.title')}</Text>
      </View>

      {/* Quick links grid */}
      <View style={styles.grid}>
        {shortcuts.map(({ label, icon: Icon, bg, iconColor, tab }) => (
          <TouchableOpacity key={label} style={styles.shortcut} onPress={() => navigation.navigate(tab)} activeOpacity={0.7}>
            <View style={[styles.shortcutIcon, { backgroundColor: bg }]}>
              <Icon size={16} color={iconColor} />
            </View>
            <Text style={styles.shortcutLabel} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Grades */}
      {grades.length > 0 && (
        <>
          <TouchableOpacity onPress={() => navigation.navigate('Grades')} activeOpacity={0.8} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>{t('nav.grades', 'Grades')}</Text>
            <Text style={{ fontSize: font.xs, color: colors.primary, fontWeight: '600' }}>See all →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Grades')} activeOpacity={0.8}>
          <View style={styles.gradesRow}>
            {grades.map(g => {
              const pct = g.grade != null && g.maxGrade ? Math.round((g.grade / g.maxGrade) * 100) : null;
              const color = pct == null ? colors.textMuted : pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.danger;
              return (
                <View key={g.id} style={styles.gradeCard}>
                  <View style={[styles.gradeCircle, { borderColor: color }]}>
                    <Text style={[styles.gradeScore, { color }]}>{g.grade ?? '—'}</Text>
                  </View>
                  <Text style={styles.gradeSubject} numberOfLines={1}>{g.subject || '—'}</Text>
                  {g.students?.fullName && <Text style={styles.gradeStudent} numberOfLines={1}>{g.students.fullName}</Text>}
                </View>
              );
            })}
          </View>
          </TouchableOpacity>
        </>
      )}

      {/* Section label */}
      <Text style={styles.sectionLabel}>{t('dashboard.latest_activity')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : feedItems.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('dashboard.no_activity')}</Text>
        </View>
      ) : (
        feedItems.map((item, i) => {
          if (item.type === 'announcement') {
            const ann = item.data;
            return (
              <View key={`a${i}`} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
                    <Megaphone size={16} color="#9333EA" />
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.metaRow}>
                      <View style={[styles.badge, { backgroundColor: '#F3E8FF' }]}>
                        <Text style={[styles.badgeText, { color: '#7C3AED' }]}>{t('dashboard.badge_announcement')}</Text>
                      </View>
                      <Text style={styles.timeText}>{timeLabel(ann.createdAt)}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{ann.title}</Text>
                    <Text style={styles.cardDesc} numberOfLines={2}>{ann.content}</Text>
                  </View>
                </View>
              </View>
            );
          }
          const hw = item.data as Homework;
          return (
            <View key={`h${i}`} style={styles.card}>
              <View style={styles.cardRow}>
                <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
                  <BookOpen size={16} color="#2563EB" />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.metaRow}>
                    <View style={[styles.badge, { backgroundColor: '#DBEAFE' }]}>
                      <Text style={[styles.badgeText, { color: '#1D4ED8' }]}>{t('dashboard.badge_homework')}</Text>
                    </View>
                    <Text style={styles.timeText}>{timeLabel(hw.createdAt)}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{hw.title}</Text>
                  {hw.description && <Text style={styles.cardDesc} numberOfLines={2}>{hw.description}</Text>}
                  <View style={styles.tagsRow}>
                    {hw.subject && (
                      <View style={styles.subjectTag}>
                        <Text style={styles.subjectTagText}>{hw.subject}</Text>
                      </View>
                    )}
                    {hw.dueDate && (
                      <Text style={styles.dueText}>{t('homework.due', { date: new Date(hw.dueDate).toLocaleDateString() })}</Text>
                    )}
                  </View>
                </View>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.md },
  greeting: { fontSize: font.sm, color: colors.textMuted, marginBottom: 2 },
  title: { fontSize: font.xxxl, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  shortcut: { width: '30.5%', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 6, ...shadow.sm },
  shortcutIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: font.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardRow: { flexDirection: 'row', gap: spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardBody: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  badge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: font.xs, fontWeight: '700' },
  timeText: { fontSize: font.xs, color: colors.textMuted },
  cardTitle: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: 3 },
  cardDesc: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 18 },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 5 },
  subjectTag: { backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  subjectTagText: { fontSize: font.xs, color: colors.textSecondary },
  dueText: { fontSize: font.xs, color: colors.warning, fontWeight: '600' },
  gradesRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  gradeCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 4, ...shadow.sm },
  gradeCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  gradeScore: { fontSize: font.md, fontWeight: '800' },
  gradeSubject: { fontSize: font.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
  gradeStudent: { fontSize: font.xs, color: colors.textMuted, textAlign: 'center' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
});
