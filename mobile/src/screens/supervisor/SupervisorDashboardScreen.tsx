import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { DashboardSkeleton } from '../../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Users, CheckCircle, Clock, FileText, ChevronRight, Bell } from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { supervisorApi, announcementApi } from '../../services/api';
import { useSocketStore } from '../../store/socketStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { spacing, radius, font, shadow } from '../../theme';
import AnnouncementCard from '../../components/AnnouncementCard';
import type { Announcement } from '../../types';

interface AbsentRecord {
  id: string;
  status: 'absent' | 'late' | 'excused';
  notes?: string;
  students?: { id: string; fullName: string; classes?: { name: string } };
  teachers?: { fullName: string };
}

interface ClassSummary {
  id: string;
  name: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export default function SupervisorDashboardScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const { socket } = useSocketStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const [absentList, setAbsentList] = useState<AbsentRecord[]>([]);
  const [summary, setSummary] = useState<ClassSummary[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifCount, setNotifCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const load = useCallback(async () => {
    const [ab, sm, ann] = await Promise.allSettled([
      supervisorApi.getAbsentToday(),
      supervisorApi.getAttendanceSummary(),
      supervisorApi.getAnnouncements(),
    ]);
    if (ab.status === 'fulfilled') setAbsentList(ab.value.data || []);
    if (sm.status === 'fulfilled') setSummary((sm.value.data || []).filter((c: ClassSummary) => c.total > 0));
    if (ann.status === 'fulfilled') {
      const b = ann.value.data;
      setAnnouncements(Array.isArray(b) ? b : b?.data ?? []);
    }
  }, []);

  const handleToggleAnnouncementLike = async (id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      liked_by_me: !a.liked_by_me,
      likes_count: (a.likes_count ?? 0) + (a.liked_by_me ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  const fetchNotifCount = useCallback(() => {
    supervisorApi.getUnreadCount()
      .then(r => setNotifCount(r.data?.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  useFocusEffect(useCallback(() => { fetchNotifCount(); }, [fetchNotifCount]));

  useEffect(() => {
    if (!socket) return;
    const onNotif = () => setNotifCount(prev => prev + 1);
    socket.on('notification', onNotif);
    return () => { socket.off('notification', onNotif); };
  }, [socket]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const totalAbsent = absentList.filter(r => r.status === 'absent').length;
  const totalLate = absentList.filter(r => r.status === 'late').length;

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('nav.dashboard')}</Text>
          <Text style={styles.subtitle}>{today}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setNotifCount(0); navigation.navigate('SupervisorNotifications'); }}
          style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
          activeOpacity={0.7}
        >
          <Bell size={18} color={headerIconColor} />
          {notifCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{notifCount > 99 ? '99+' : notifCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.dangerLight }]}>
          <AlertCircle size={20} color={colors.danger} />
          <Text style={[styles.statNum, { color: colors.danger }]}>{totalAbsent}</Text>
          <Text style={[styles.statLabel, { color: colors.danger }]}>{t('common.absent')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.warningLight }]}>
          <Clock size={20} color={colors.warning} />
          <Text style={[styles.statNum, { color: colors.warning }]}>{totalLate}</Text>
          <Text style={[styles.statLabel, { color: colors.warning }]}>{t('common.late')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.successLight }]}>
          <Users size={20} color={colors.success} />
          <Text style={[styles.statNum, { color: colors.success }]}>{summary.reduce((a, c) => a + c.present, 0)}</Text>
          <Text style={[styles.statLabel, { color: colors.success }]}>{t('common.present')}</Text>
        </View>
      </View>

      {/* Shortcut cards */}
      <View style={styles.shortcutRow}>
        {feat('weekly_summary') && (
          <TouchableOpacity
            style={styles.shortcutCard}
            onPress={() => navigation.navigate('SupervisorContent', { initialTab: 'weekly' })}
          >
            <Clock size={20} color={colors.primary} />
            <Text style={styles.shortcutText}>{t('supervisor.weekly_summary')}</Text>
            <ChevronRight size={14} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.shortcutCard}
          onPress={() => navigation.navigate('SupervisorContent', { initialTab: 'reports' })}
        >
          <FileText size={20} color={colors.primary} />
          <Text style={styles.shortcutText}>{t('supervisor.student_reports')}</Text>
          <ChevronRight size={14} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      </View>

      {loading ? <DashboardSkeleton /> : (
        <>
          {/* Absent / Late today */}
          <Text style={styles.sectionLabel}>{t('supervisor.absent_late_today')}</Text>
          {absentList.length === 0 ? (
            <View style={styles.emptyCard}>
              <CheckCircle size={28} color={colors.success} />
              <Text style={styles.emptyText}>{t('supervisor.all_present_today')}</Text>
            </View>
          ) : (
            absentList.map(r => (
              <View key={r.id} style={styles.absentCard}>
                <View style={[styles.statusDot, { backgroundColor: r.status === 'absent' ? colors.danger : r.status === 'excused' ? '#8B5CF6' : colors.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{r.students?.fullName ?? '—'}</Text>
                  <Text style={styles.studentMeta}>
                    {r.students?.classes?.name ?? ''}
                    {r.teachers?.fullName ? ` · ${r.teachers.fullName}` : ''}
                  </Text>
                  {r.notes && <Text style={styles.noteText}>{r.notes}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: r.status === 'absent' ? colors.danger + '20' : r.status === 'excused' ? '#8B5CF620' : colors.warning + '20' }]}>
                  <Text style={[styles.statusBadgeText, { color: r.status === 'absent' ? colors.danger : r.status === 'excused' ? '#8B5CF6' : colors.warning }]}>
                    {r.status === 'absent' ? t('common.absent') : r.status === 'excused' ? t('supervisor.excused') : t('common.late')}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Class summary */}
          {summary.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>{t('supervisor.attendance_by_class')}</Text>
              {summary.map(cls => {
                const presentPct = cls.total > 0 ? cls.present / cls.total : 0;
                return (
                  <View key={cls.id} style={styles.summaryCard}>
                    <View style={styles.summaryTop}>
                      <Text style={styles.className}>{cls.name}</Text>
                      <Text style={styles.classTotal}>{cls.present}/{cls.total}</Text>
                    </View>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, { width: `${presentPct * 100}%` as any, backgroundColor: presentPct >= 0.8 ? colors.success : presentPct >= 0.6 ? colors.warning : colors.danger }]} />
                    </View>
                    <View style={styles.summaryRow}>
                      {cls.absent > 0 && <Text style={[styles.summaryChip, { color: colors.danger }]}>{t('teacher.n_absent', { count: cls.absent })}</Text>}
                      {cls.late > 0 && <Text style={[styles.summaryChip, { color: colors.warning }]}>{t('teacher.n_late', { count: cls.late })}</Text>}
                      {cls.present > 0 && <Text style={[styles.summaryChip, { color: colors.success }]}>{t('teacher.n_present', { count: cls.present })}</Text>}
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* Announcements */}
          {announcements.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>{t('nav.announcements')}</Text>
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
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, _isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 14, height: 14, borderRadius: 7,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 2,
  },
  bellBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 4 },
  statNum: { fontSize: font.xxl, fontWeight: '800' },
  statLabel: { fontSize: font.xs, fontWeight: '600' },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted },
  absentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  studentName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  studentMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  noteText: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  statusBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  summaryCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  className: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  classTotal: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  barBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: spacing.sm, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summaryChip: { fontSize: font.xs, fontWeight: '600' },
  shortcutRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  shortcutCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, ...shadow.sm },
  shortcutText: { fontSize: font.xs, fontWeight: '600', color: colors.text, flex: 1 },
});
