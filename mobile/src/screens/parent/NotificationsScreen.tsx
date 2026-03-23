import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Notification } from '../../types';
import type { RootStackParamList } from '../../navigation';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function getDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface Group {
  label: string;
  items: Notification[];
}

function groupByDay(notifications: Notification[]): Group[] {
  const map = new Map<string, Group>();
  for (const n of notifications) {
    const key = getDayKey(n.createdAt);
    if (!map.has(key)) {
      map.set(key, { label: getDayLabel(n.createdAt), items: [] });
    }
    map.get(key)!.items.push(n);
  }
  return Array.from(map.values());
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrevious, setShowPrevious] = useState(false);

  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);

  useEffect(() => {
    parentApi.markAllRead().catch(() => {});
    setUnreadCount(0);
    parentApi.getNotifications()
      .then(r => setItems(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id: string) => {
    await parentApi.markRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handlePress = async (item: Notification) => {
    if (!item.isRead) markRead(item.id);
    if (!item.relatedId) return;
    try {
      if (item.notificationType === 'homework') {
        const res = await parentApi.getHomeworkById(item.relatedId);
        navigation.navigate('HomeworkDetail', { homework: res.data });
      } else if (item.notificationType === 'assignment') {
        const res = await parentApi.getAssignmentById(item.relatedId);
        navigation.navigate('AssignmentDetail', { assignment: res.data });
      } else if (item.notificationType === 'announcement') {
        const res = await parentApi.getAnnouncementById(item.relatedId);
        navigation.navigate('AnnouncementDetail', { announcement: res.data });
      } else if (item.notificationType === 'report') {
        const res = await parentApi.getReportById(item.relatedId);
        navigation.navigate('ReportDetail', { report: res.data });
      }
    } catch {
      // If fetch fails, do nothing
    }
  };

  const groups = useMemo(() => groupByDay(items), [items]);
  const recentGroups = useMemo(() => groups.filter(g => g.label === 'Today' || g.label === 'Yesterday'), [groups]);
  const olderGroups = useMemo(() => groups.filter(g => g.label !== 'Today' && g.label !== 'Yesterday'), [groups]);
  const showingSplit = recentGroups.length > 0 && olderGroups.length > 0;
  const displayedGroups = showPrevious || !showingSplit ? groups : recentGroups;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('notifications.title')}</Text>
        <Text style={styles.subtitle}>{t('notifications.subtitle')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('notifications.no_notifications')}</Text>
      ) : (
        <>
          {displayedGroups.map(group => (
            <View key={group.label}>
              <Text style={styles.dayLabel}>{group.label}</Text>
              {group.items.map(item => (
                <TouchableOpacity key={item.id} activeOpacity={0.75}
                  style={[styles.card, !item.isRead && styles.cardUnread]}
                  onPress={() => handlePress(item)}>
                  {!item.isRead && <View style={styles.dot} />}
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
                  <Text style={[styles.cardTime, { marginTop: 10 }]}>{formatTime(item.createdAt)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {showingSplit && !showPrevious && (
            <TouchableOpacity style={styles.prevButton} activeOpacity={0.7} onPress={() => setShowPrevious(true)}>
              <Text style={styles.prevButtonText}>See previous notifications</Text>
            </TouchableOpacity>
          )}
        </>
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
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: font.md },
  dayLabel: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginBottom: 6 },
  cardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  cardMessage: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 18 },
  cardTime: { fontSize: font.xs, color: colors.textMuted },
  prevButton: {
    borderWidth: 1, borderColor: colors.primary + '40',
    borderRadius: radius.md, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.sm,
    backgroundColor: colors.card,
  },
  prevButtonText: { fontSize: font.sm, color: colors.primary, fontWeight: '600' },
});
