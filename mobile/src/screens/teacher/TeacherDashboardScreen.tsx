import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { DashboardSkeleton } from '../../components/Skeleton';
import { useNavigation } from '@react-navigation/native';
import { CalendarCheck, BookOpen, ClipboardList, Star, FileText, Clock, ChevronRight, Calendar } from 'lucide-react-native';
import { teacherApi, announcementApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import AnnouncementCard from '../../components/AnnouncementCard';
import { spacing, radius, font, shadow } from '../../theme';
import type { Announcement } from '../../types';

interface ClassItem { id: string; name: string }
interface HomeworkItem { id: string; title: string; subject?: string; dueDate?: string; classes?: { name: string } }
interface PeriodItem { id: string; weekStartDate: string; weekEndDate: string }
interface ScheduleCell { id: string; dayOfWeek: number; periodIndex: number; classes?: { id: string; name: string } }

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
const DAY_LABEL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export default function TeacherDashboardScreen() {
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const navigation = useNavigation<any>();
  const { user, school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [recentHw, setRecentHw] = useState<HomeworkItem[]>([]);
  const [period, setPeriod] = useState<PeriodItem | null>(null);
  const [scheduleCells, setScheduleCells] = useState<ScheduleCell[]>([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const load = useCallback(async () => {
    const [cls, hw, pd, sched, ann] = await Promise.allSettled([
      teacherApi.getClasses(),
      teacherApi.getHomework(),
      teacherApi.getActivePeriod(),
      teacherApi.getSchedule(),
      teacherApi.getAnnouncements(),
    ]);
    if (cls.status === 'fulfilled') setClasses(cls.value.data || []);
    if (hw.status === 'fulfilled') setRecentHw((hw.value.data || []).slice(0, 3));
    if (pd.status === 'fulfilled') setPeriod(pd.value.data || null);
    if (sched.status === 'fulfilled') {
      setPeriodsPerDay(sched.value.data?.periodsPerDay ?? 6);
      setScheduleDays(sched.value.data?.scheduleDays ?? []);
      setScheduleCells(sched.value.data?.assignments ?? []);
    }
    if (ann.status === 'fulfilled') setAnnouncements(ann.value.data || []);
  }, []);

  const handleToggleAnnouncementLike = async (id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      liked_by_me: !a.liked_by_me,
      likes_count: (a.likes_count ?? 0) + (a.liked_by_me ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const actions = [
    feat('attendance') && { label: 'Attendance', icon: CalendarCheck, tab: 'TeacherAttendance', color: '#10B981', bg: '#D1FAE5' },
    { label: 'Homework', icon: BookOpen, tab: 'TeacherContent', params: { initialTab: 'homework' }, color: '#3B82F6', bg: '#EFF6FF' },
    { label: 'Assignments', icon: ClipboardList, tab: 'TeacherContent', params: { initialTab: 'assignments' }, color: '#8B5CF6', bg: '#F5F3FF' },
    feat('grades') && { label: 'Grades', icon: Star, tab: 'TeacherContent', params: { initialTab: 'grades' }, color: '#F59E0B', bg: '#FEF3C7' },
    feat('reports') && { label: 'Reports', icon: FileText, tab: 'TeacherContent', params: { initialTab: 'reports' }, color: '#EF4444', bg: '#FEE2E2' },
    feat('weekly_summary') && { label: 'Weekly Summary', icon: Clock, tab: 'TeacherContent', params: { initialTab: 'weekly' }, color: '#06B6D4', bg: '#ECFEFF' },
  ].filter(Boolean) as { label: string; icon: any; tab: string; params?: object; color: string; bg: string }[];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>{today}</Text>
      <Text style={styles.greeting}>Welcome, {user?.firstName}</Text>

      {/* Classes row */}
      {classes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {classes.map(c => (
            <View key={c.id} style={styles.classChip}>
              <Text style={styles.classChipText}>{c.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Active period banner */}
      {period && feat('weekly_summary') && (
        <TouchableOpacity
          style={styles.periodBanner}
          onPress={() => navigation.navigate('TeacherContent', { initialTab: 'weekly' })}
        >
          <Clock size={16} color={colors.success} />
          <Text style={styles.periodText}>
            Summary period open · {new Date(period.weekStartDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {new Date(period.weekEndDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
          <ChevronRight size={14} color={colors.success} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      )}

      {/* Quick actions */}
      <Text style={styles.sectionLabel}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        {actions.map(({ label, icon: Icon, tab, params, color, bg }) => (
          <TouchableOpacity
            key={label}
            style={styles.actionCard}
            onPress={() => navigation.navigate(tab, params)}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIcon, { backgroundColor: bg }]}>
              <Icon size={20} color={color} />
            </View>
            <Text style={styles.actionLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Today's classes — compact view; full grid lives on TeacherSchedule screen */}
      {scheduleDays.length > 0 && (() => {
        const todayName = DAY_NAMES[new Date().getDay()];
        const todayIdx = new Date().getDay();
        const todayCells = scheduleCells
          .filter(c => c.dayOfWeek === todayIdx)
          .sort((a, b) => a.periodIndex - b.periodIndex);
        const todayIsScheduled = scheduleDays.includes(todayName);

        return (
          <>
            <View style={styles.scheduleHeader}>
              <Text style={styles.sectionLabel}>Today's Classes</Text>
              <TouchableOpacity onPress={() => navigation.navigate('TeacherSchedule')} hitSlop={8}>
                <Text style={styles.seeAllLink}>Full schedule →</Text>
              </TouchableOpacity>
            </View>
            {!todayIsScheduled ? (
              <View style={styles.scheduleEmpty}>
                <Calendar size={16} color={colors.textMuted} />
                <Text style={styles.scheduleEmptyText}>
                  No school today ({DAY_LABEL[todayIdx]}).
                </Text>
              </View>
            ) : todayCells.length === 0 ? (
              <View style={styles.scheduleEmpty}>
                <Calendar size={16} color={colors.textMuted} />
                <Text style={styles.scheduleEmptyText}>No classes scheduled for today.</Text>
              </View>
            ) : (
              <View style={styles.todayList}>
                {Array.from({ length: periodsPerDay }, (_, i) => {
                  const cell = todayCells.find(c => c.periodIndex === i + 1);
                  return (
                    <View key={i} style={styles.todayRow}>
                      <Text style={styles.todayPeriod}>P{i + 1}</Text>
                      {cell?.classes?.name ? (
                        <Text style={styles.todayClass}>{cell.classes.name}</Text>
                      ) : (
                        <Text style={styles.todayEmpty}>—</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        );
      })()}

      {/* Recent homework */}
      {loading ? (
        <DashboardSkeleton />
      ) : recentHw.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Recent Homework</Text>
          {recentHw.map(hw => (
            <TouchableOpacity
              key={hw.id}
              style={styles.hwCard}
              onPress={() => navigation.navigate('TeacherContent', { initialTab: 'homework' })}
            >
              <View style={styles.hwIconBox}>
                <BookOpen size={16} color="#3B82F6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hwTitle}>{hw.title}</Text>
                <Text style={styles.hwMeta}>
                  {[hw.subject, hw.classes?.name].filter(Boolean).join(' · ')}
                  {hw.dueDate ? ` · Due ${new Date(hw.dueDate).toLocaleDateString()}` : ''}
                </Text>
              </View>
              <ChevronRight size={14} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      {/* Announcements */}
      {announcements.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Announcements</Text>
          {announcements.map(ann => (
            <AnnouncementCard
              key={ann.id}
              announcement={ann}
              onPress={() => navigation.navigate('AnnouncementDetail', { announcement: ann })}
              onPressComment={() => navigation.navigate('AnnouncementDetail', { announcement: ann, focusComment: true })}
              onToggleLike={() => handleToggleAnnouncementLike(ann.id)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  greeting: { fontSize: font.md, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  classChip: {
    borderRadius: radius.full,
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight,
    paddingHorizontal: 14, paddingVertical: 7, marginRight: spacing.sm,
  },
  classChipText: { fontSize: font.xs, fontWeight: '700', color: isDark ? '#FFFFFF' : colors.primary },
  periodBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.successLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  periodText: { fontSize: font.xs, fontWeight: '600', color: colors.success, flex: 1 },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  actionCard: { width: '30%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: spacing.sm, ...shadow.sm },
  actionIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: font.xs, fontWeight: '600', color: colors.text, textAlign: 'center' },
  hwCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  hwIconBox: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  hwTitle: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  hwMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  scheduleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  seeAllLink: { fontSize: font.xs, fontWeight: '600', color: colors.primary },
  scheduleEmpty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  scheduleEmptyText: { fontSize: font.sm, color: colors.textMuted, flex: 1 },
  todayList: { backgroundColor: colors.card, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.xs, ...shadow.sm },
  todayRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  todayPeriod: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, width: 32 },
  todayClass: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  todayEmpty: { fontSize: font.sm, color: colors.textMuted },
});
