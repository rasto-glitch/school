import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useRoute, RouteProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BookOpen, ClipboardList, FileText } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { spacing, radius, font, shadow } from '../../theme';
import SupervisorStudentReportsScreen from './SupervisorStudentReportsScreen';

// Phase D — supervisors view homework/assignments read-only (no delete); the
// weekly-summary tab moved to admin (academics.oversee).
type TabType = 'homework' | 'assignments' | 'reports';

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
  const navigation = useNavigation<any>();
  const initialTab = (route.params as { initialTab?: TabType } | undefined)?.initialTab;
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const ALL_TABS: { key: TabType; label: string; icon: typeof BookOpen; feature?: string }[] = [
    { key: 'homework',    label: t('nav.homework'),                icon: BookOpen },
    { key: 'assignments', label: t('nav.assignments'),             icon: ClipboardList },
    { key: 'reports',     label: t('supervisor.student_reports'),  icon: FileText },
  ];
  const TABS = ALL_TABS.filter(tab => !tab.feature || feat(tab.feature));

  const validInitialTab = initialTab && TABS.find(tb => tb.key === initialTab) ? initialTab : undefined;
  const [tab, setTab] = useState<TabType>(validInitialTab ?? 'homework');
  const [homework, setHomework] = useState<ContentItem[]>([]);
  const [assignments, setAssignments] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Update tab when navigating from dashboard shortcuts (runs on every focus)
  useFocusEffect(
    useCallback(() => {
      if (initialTab && TABS.find(tb => tb.key === initialTab)) setTab(initialTab);
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

  const items = tab === 'homework' ? homework : assignments;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Fixed header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>{t('nav.content')}</Text>
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
      {tab === 'reports' ? (
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
              <Text style={styles.emptyText}>{tab === 'homework' ? t('supervisor.no_homework_found') : t('supervisor.no_assignments_found')}</Text>
            </View>
          ) : (
            items.map(item => (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => navigation.navigate(
                  tab === 'homework' ? 'HomeworkDetail' : 'AssignmentDetail',
                  tab === 'homework' ? { homework: item } : { assignment: item },
                )}
              >
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
                    <Text style={styles.dueText}>{t('common.due')} {new Date(item.dueDate).toLocaleDateString()}</Text>
                  )}
                  <Text style={styles.dateText}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
              </TouchableOpacity>
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
