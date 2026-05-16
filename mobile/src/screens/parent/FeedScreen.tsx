import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { DashboardSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { FileText, FileBadge, Calendar, BookOpen, ClipboardList } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { parentApi, announcementApi } from '../../services/api';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { spacing, radius, shadow, font } from '../../theme';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import AnnouncementCard from '../../components/AnnouncementCard';
import type { Announcement } from '../../types';

interface Grade {
  id: string;
  subject?: string;
  grade?: number;
  maxGrade?: number;
  students?: { fullName: string };
}

export default function FeedScreen() {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;
  const navigation = useNavigation<any>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { reportCount, bookingCount, homeworkCount, assignmentCount, gradeCount } = useBadgeStore();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [ann, gr] = await Promise.allSettled([
      parentApi.getAnnouncements(),
      parentApi.getGrades(),
    ]);
    if (ann.status === 'fulfilled') setAnnouncements(ann.value.data || []);
    if (gr.status === 'fulfilled') setGrades((gr.value.data || []).slice(0, 3));
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  useRefreshOnFocus(load);

  const onRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  const handleToggleLike = async (id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      liked_by_me: !a.liked_by_me,
      likes_count: (a.likes_count ?? 0) + (a.liked_by_me ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  const shortcuts = [
    feat('reports') && { label: t('dashboard.quick_reports', 'Reports'), icon: FileText, bg: '#FAF5FF', iconColor: '#9333EA', tab: 'Reports', count: reportCount },
    feat('grades') && { label: t('dashboard.quick_grades', 'Grades'), icon: FileBadge, bg: '#EEF2FF', iconColor: '#4F46E5', tab: 'Grades', count: gradeCount },
    feat('appointments') && { label: t('dashboard.quick_bookings', 'Bookings'), icon: Calendar, bg: '#F0FDFA', iconColor: '#0D9488', tab: 'Appointments', count: bookingCount },
    feat('homework') && { label: t('nav.homework', 'Homework'), icon: BookOpen, bg: '#ECFDF5', iconColor: '#059669', tab: 'Homework', count: homeworkCount },
    feat('assignments') && { label: t('nav.assignments', 'Assignments'), icon: ClipboardList, bg: '#FEF3C7', iconColor: '#D97706', tab: 'Assignments', count: assignmentCount },
  ].filter(Boolean) as { label: string; icon: any; bg: string; iconColor: string; tab: string; count: number }[];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('dashboard.subtitle', { name: user?.firstName })}</Text>
        <Text style={styles.title}>{t('dashboard.title')}</Text>
      </View>

      {/* Quick links grid */}
      <View style={styles.grid}>
        {shortcuts.map(({ label, icon: Icon, bg, iconColor, tab, count }) => (
          <TouchableOpacity key={label} style={styles.shortcut} onPress={() => navigation.navigate(tab)} activeOpacity={0.7}>
            <View style={[styles.shortcutIcon, { backgroundColor: bg }]}>
              <Icon size={16} color={iconColor} />
              {count > 0 && (
                <View style={styles.shortcutBadge}>
                  <Text style={styles.shortcutBadgeText}>{count > 99 ? '99+' : count}</Text>
                </View>
              )}
            </View>
            <Text style={styles.shortcutLabel} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Grades */}
      {feat('grades') && grades.length > 0 && (
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
        <DashboardSkeleton />
      ) : announcements.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('dashboard.no_activity')}</Text>
        </View>
      ) : (
        announcements.map(ann => (
          <AnnouncementCard
            key={ann.id}
            announcement={ann}
            onPress={() => navigation.navigate('AnnouncementDetail', { announcement: ann })}
            onPressComment={() => navigation.navigate('AnnouncementDetail', { announcement: ann, focusComment: true })}
            onToggleLike={() => handleToggleLike(ann.id)}
          />
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.md },
  greeting: { fontSize: font.sm, color: colors.textMuted, marginBottom: 2 },
  title: { fontSize: font.xxxl, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.md },
  shortcut: { width: '30.5%', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 6, ...shadow.sm },
  shortcutIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: font.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
  shortcutBadge: { position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  shortcutBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  gradesRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  gradeCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 4, ...shadow.sm },
  gradeCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  gradeScore: { fontSize: font.md, fontWeight: '800' },
  gradeSubject: { fontSize: font.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
  gradeStudent: { fontSize: font.xs, color: colors.textMuted, textAlign: 'center' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
});
