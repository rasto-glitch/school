import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, ClipboardList, Trash2 } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

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
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tab, setTab] = useState<'homework' | 'assignments'>('homework');
  const [homework, setHomework] = useState<ContentItem[]>([]);
  const [assignments, setAssignments] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    Alert.alert(
      `Delete ${tab === 'homework' ? 'Homework' : 'Assignment'}`,
      `Are you sure you want to delete "${item.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setDeletingId(item.id);
            try {
              if (tab === 'homework') {
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Content</Text>

      {/* Tab toggle */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'homework' && styles.tabBtnActive]}
          onPress={() => setTab('homework')}
        >
          <BookOpen size={15} color={tab === 'homework' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabBtnText, tab === 'homework' && styles.tabBtnTextActive]}>
            Homework {homework.length > 0 ? `(${homework.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'assignments' && styles.tabBtnActive]}
          onPress={() => setTab('assignments')}
        >
          <ClipboardList size={15} color={tab === 'assignments' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabBtnText, tab === 'assignments' && styles.tabBtnTextActive]}>
            Assignments {assignments.length > 0 ? `(${assignments.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
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
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, marginBottom: spacing.md, ...shadow.sm },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.sm },
  tabBtnActive: { backgroundColor: colors.primaryLight },
  tabBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  tabBtnTextActive: { color: colors.primary },
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
