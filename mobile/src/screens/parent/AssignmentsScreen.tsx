import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ClipboardList, Calendar, ChevronRight } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { RootStackParamList } from '../../navigation';

interface Assignment {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  dueDate?: string;
  submissionStatus?: string;
  grade?: number | null;
  createdAt: string;
  classes?: { name: string };
  students?: { fullName: string };
}

export default function AssignmentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialized = useRef(false);
  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);
  const clearAssignment = useBadgeStore(s => s.clearAssignment);

  const load = () => parentApi.getAssignments().then(r => setAssignments(r.data || []));

  useFocusEffect(
    useCallback(() => {
      if (!initialized.current) {
        initialized.current = true;
        load().finally(() => setLoading(false));
      } else {
        load();
      }
      clearAssignment();
      parentApi.markTypeRead('assignment').catch(() => {});
      parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }, [])
  );

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('nav.assignments', 'Assignments')}</Text>
        <Text style={styles.subtitle}>{t('assignments.subtitle', 'Your assignments')}</Text>
      </View>

      {loading ? (
        <CardListSkeleton count={4} />
      ) : assignments.length === 0 ? (
        <View style={styles.emptyBox}>
          <ClipboardList size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('assignments.no_assignments', 'No assignments yet')}</Text>
        </View>
      ) : (
        assignments.map(item => {
          const overdue = item.dueDate ? new Date(item.dueDate) < new Date() : false;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('AssignmentDetail', { assignment: item })}
            >
              <View style={styles.cardRow}>
                <View style={styles.iconBox}>
                  <ClipboardList size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.topRow}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                    {item.subject && (
                      <View style={styles.pill}><Text style={styles.pillText}>{item.subject}</Text></View>
                    )}
                  </View>
                  {item.classes?.name && <Text style={styles.meta}>{item.classes.name}</Text>}
                  {item.description && <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>}
                  {item.dueDate && (
                    <View style={styles.dueRow}>
                      <Calendar size={12} color={overdue ? colors.danger : colors.textMuted} />
                      <Text style={[styles.due, overdue && styles.overdue]}>
                        {new Date(item.dueDate).toLocaleDateString()}
                      </Text>
                      {overdue && <View style={styles.overdueBadge}><Text style={styles.overdueBadgeText}>{t('common.overdue')}</Text></View>}
                    </View>
                  )}
                </View>
                <ChevronRight size={16} color={colors.textMuted} style={{ alignSelf: 'center' }} />
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardRow: { flexDirection: 'row', gap: spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  pill: { backgroundColor: '#DCFCE7', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: font.xs, fontWeight: '700', color: '#16A34A' },
  meta: { fontSize: font.xs, color: colors.textMuted, marginBottom: 4 },
  desc: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  due: { fontSize: font.xs, color: colors.textMuted },
  overdue: { color: colors.danger, fontWeight: '600' },
  overdueBadge: { backgroundColor: colors.dangerLight, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  overdueBadgeText: { fontSize: font.xs, color: colors.danger, fontWeight: '700' },
});
