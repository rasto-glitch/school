import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { TouchableOpacity } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, ClipboardList, Star, FileText, Clock } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { spacing, radius, font, shadow } from '../../theme';
import TeacherHomeworkScreen from './TeacherHomeworkScreen';
import TeacherAssignmentsScreen from './TeacherAssignmentsScreen';
import TeacherGradingScreen from './TeacherGradingScreen';
import TeacherReportScreen from './TeacherReportScreen';
import TeacherWeeklySummaryScreen from './TeacherWeeklySummaryScreen';

type TabKey = 'homework' | 'assignments' | 'grades' | 'reports' | 'weekly';
interface ClassItem { id: string; name: string }

export default function TeacherContentScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const route = useRoute<RouteProp<{ params: { initialTab?: TabKey } }, 'params'>>();
  const initialTab = (route.params as { initialTab?: TabKey } | undefined)?.initialTab;

  const ALL_TABS: { key: TabKey; label: string; icon: typeof BookOpen; feature?: string }[] = [
    { key: 'homework',    label: 'Homework',    icon: BookOpen },
    { key: 'assignments', label: 'Assignments', icon: ClipboardList },
    { key: 'grades',      label: 'Grades',      icon: Star,      feature: 'grades' },
    { key: 'reports',     label: 'Reports',     icon: FileText,  feature: 'reports' },
    { key: 'weekly',      label: 'Weekly',      icon: Clock,     feature: 'weekly_summary' },
  ];
  const TABS = ALL_TABS.filter(t => !t.feature || feat(t.feature));

  const validInitial = initialTab && TABS.find(t => t.key === initialTab) ? initialTab : 'homework';
  const [tab, setTab] = useState<TabKey>(validInitial);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subject, setSubject] = useState<string | undefined>();
  const [academicYear, setAcademicYear] = useState<string | undefined>();
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      teacherApi.getClasses(),
      teacherApi.getProfileData(),
      teacherApi.getSettings(),
    ]).then(([cls, profile, settings]) => {
      if (cls.status === 'fulfilled') setClasses(cls.value.data || []);
      if (profile.status === 'fulfilled') setSubject(profile.value.data?.subject);
      if (settings.status === 'fulfilled') setAcademicYear(settings.value.data?.academicYear);
    }).finally(() => setProfileLoading(false));
  }, []);

  // Update tab if route params change (e.g. navigating from dashboard)
  useEffect(() => {
    if (initialTab && TABS.find(t => t.key === initialTab)) setTab(initialTab);
  }, [initialTab]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Fixed header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Content</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setTab(key)}
              >
                <Icon size={14} color={active ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {profileLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : tab === 'homework' ? (
        <TeacherHomeworkScreen subject={subject} classes={classes} />
      ) : tab === 'assignments' ? (
        <TeacherAssignmentsScreen subject={subject} classes={classes} />
      ) : tab === 'grades' ? (
        <TeacherGradingScreen subject={subject} classes={classes} academicYear={academicYear} />
      ) : tab === 'reports' ? (
        <TeacherReportScreen subject={subject} classes={classes} />
      ) : (
        <TeacherWeeklySummaryScreen subject={subject} classes={classes} />
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  root: { flex: 1 },
  header: { backgroundColor: colors.bg, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  tabBar: { flexDirection: 'row', gap: spacing.xs, paddingBottom: spacing.xs },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.full, backgroundColor: colors.card, ...shadow.sm },
  tabBtnActive: { backgroundColor: colors.primaryLight },
  tabBtnText: { fontSize: font.xs, fontWeight: '600', color: colors.textMuted },
  tabBtnTextActive: { color: colors.primary },
});
