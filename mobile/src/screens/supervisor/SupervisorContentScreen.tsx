import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BookOpen, ClipboardList, Trash2, Clock, FileText } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { spacing, radius, font, shadow } from '../../theme';
import SupervisorWeeklySummaryScreen from './SupervisorWeeklySummaryScreen';
import SupervisorStudentReportsScreen from './SupervisorStudentReportsScreen';

type TabType = 'homework' | 'assignments' | 'weekly' | 'reports';

interface ContentItem {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  dueDate?: string;
  createdAt: string;
  teachers?: { fullName: string };
  classes?: { name: string };
}

export default function SupervisorContentScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const route = useRoute<RouteProp<{ params: { initialTab?: TabType } }, 'params'>>();
  const initialTab = (route.params as { initialTab?: TabType } | undefined)?.initialTab;
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const ALL_TABS: { key: TabType; label: string; icon: typeof BookOpen; feature?: string }[] = [
    { key: 'homework',    label: t('nav.homework'),                icon: BookOpen },
    { key: 'assignments', label: t('nav.assignments'),             icon: ClipboardList },
    { key: 'weekly',      label: t('supervisor.weekly_summary'),   icon: Clock,        feature: 'weekly_summary' },
    { key: 'reports',     label: t('supervisor.student_reports'),  icon: FileText },
  ];
  const TABS = ALL_TABS.filter(tab => !tab.feature || feat(tab.feature));

  const validInitialTab = initialTab && feat(initialTab === 'weekly' ? 'weekly_summary' : initialTab) ? initialTab : undefined;
  const [tab, setTab] = useState<TabType>(validInitialTab ?? 'homework');
  const [homework, setHomework] = useState<ContentItem[]>([]);
  const [assignments, setAssignments] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Update tab when navigating from dashboard shortcuts (runs on every focus)
  useFocusEffect(
    useCallback(() => {
      if (initialTab && TABS.find(t => t.key === initialTab)) setTab(initialTab);
    }, [initialTab])
  );

  const load = useCallback(async () => {
    const [hw, as_] = await Promise.allSettled([
      supervisorApi.getHomework(),
      supervisorApi.getAssignments(),
    ]);
    if (hw.status === 'fulfilled') setHomework(hw.value.data || []);
    if (as_.status === 'fulfilled') setAssignments(as_.value.data || []);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const handleDelete = (item: ContentItem) => {
    const isHw = tab === 'homework';
    Alert.alert(
      `Delete ${isHw ? 'Homework' : 'Assignment'}`,
      `Are you sure you want to delete "${item.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setDeletingId(item.id);
            try {
              if (isHw) {
                await supervisorApi.deleteHomework(item.id);
                setHomework(prev => prev.filter(h => h.id !== item.id));
              } else {
                await supervisorApi.deleteAssignment(item.id);
                setAssignments(prev => prev.filter(a => a.id !== item.id));
              }
            } catch {
              Alert.alert('Error', 'Could not delete item.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const items = tab === 'homework' ? homework : assignments;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Fixed header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Content</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setTab(key)}
              >
                <Icon size={14} color={active ? (isDark ? '#000000' : colors.primary) : (isDark ? '#FFFFFF' : colors.textMuted)} />
                <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content area */}
      {tab === 'weekly' ? (
        <SupervisorWeeklySummaryScreen embedded />
      ) : tab === 'reports' ? (
        <SupervisorStudentReportsScreen embedded />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {loading ? (
            <CardListSkeleton count={4} />
          ) : items.length === 0 ? (
            <View style={styles.emptyCard}>
              {tab === 'homework'
                ? <BookOpen size={36} color={colors.textMuted} />
                : <ClipboardList size={36} color={colors.textMuted} />}
              <Text style={styles.emptyText}>No {tab === 'homework' ? 'homework' : 'assignments'} found.</Text>
            </View>
          ) : (
            items.map(item => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.iconBox, { backgroundColor: tab === 'homework' ? '#EFF6FF' : '#F0FDF4' }]}>
                    {tab === 'homework'
                      ? <BookOpen size={16} color="#2563EB" />
                      : <ClipboardList size={16} color="#16A34A" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemMeta}>
                      {[item.classes?.name, item.teachers?.fullName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    style={styles.deleteBtn}
                    disabled={deletingId === item.id}
                  >
                    {deletingId === item.id
                      ? <ActivityIndicator size="small" color={colors.danger} />
                      : <Trash2 size={16} color={colors.danger} />}
                  </TouchableOpacity>
                </View>
                {item.description && (
                  <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
                )}
                <View style={styles.tagsRow}>
                  {item.subject && (
                    <View style={styles.subjectTag}>
                      <Text style={styles.subjectTagText}>{item.subject}</Text>
                    </View>
                  )}
                  {item.dueDate && (
                    <Text style={styles.dueText}>Due {new Date(item.dueDate).toLocaleDateString()}</Text>
                  )}
                  <Text style={styles.dateText}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  root: { flex: 1 },
  header: { backgroundColor: colors.bg, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  tabBar: { flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.xs },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.full,
    backgroundColor: isDark ? 'transparent' : colors.card,
    borderWidth: isDark ? 1.5 : 0,
    borderColor: isDark ? '#FFFFFF' : 'transparent',
    ...(isDark ? {} : shadow.sm),
  },
  tabBtnActive: {
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
    borderColor: isDark ? '#FFFFFF' : 'transparent',
  },
  tabBtnText: { fontSize: font.xs, fontWeight: '600', color: isDark ? '#FFFFFF' : colors.textMuted },
  tabBtnTextActive: { color: isDark ? '#000000' : colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  emptyCard: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.xs },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  itemMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  deleteBtn: { padding: 6 },
  itemDesc: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  subjectTag: { backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  subjectTagText: { fontSize: font.xs, color: colors.textSecondary },
  dueText: { fontSize: font.xs, color: colors.warning, fontWeight: '600' },
  dateText: { fontSize: font.xs, color: colors.textMuted, marginLeft: 'auto' },
});
