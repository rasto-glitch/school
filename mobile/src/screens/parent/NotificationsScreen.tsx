import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { usePaginated } from '../../hooks/usePaginated';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BookOpen, ClipboardList, Megaphone, FileText, Calendar,
  FileBadge, Bus, MessageSquare, Settings as SettingsIcon, Bell,
  CreditCard, BellRing, Wallet,
} from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, shadow, font } from '../../theme';
import { openNotificationTarget } from '../../utils/notificationNav';
import type { Notification } from '../../types';

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

const TYPE_ICONS: Record<string, { Icon: any; bg: string; color: string }> = {
  chat: { Icon: MessageSquare, bg: '#DBEAFE', color: '#2563EB' },
  homework: { Icon: BookOpen, bg: '#ECFDF5', color: '#059669' },
  assignment: { Icon: ClipboardList, bg: '#FEF3C7', color: '#D97706' },
  announcement: { Icon: Megaphone, bg: '#F3E8FF', color: '#7C3AED' },
  report: { Icon: FileText, bg: '#FAF5FF', color: '#9333EA' },
  appointment: { Icon: Calendar, bg: '#F0FDFA', color: '#0D9488' },
  grade: { Icon: FileBadge, bg: '#EEF2FF', color: '#4F46E5' },
  bus: { Icon: Bus, bg: '#FEE2E2', color: '#DC2626' },
  payment_recorded: { Icon: CreditCard, bg: '#DCFCE7', color: '#16A34A' },
  fees_reminder: { Icon: BellRing, bg: '#FEF3C7', color: '#D97706' },
  salary_paid: { Icon: Wallet, bg: '#DCFCE7', color: '#16A34A' },
  salary_due_soon: { Icon: Wallet, bg: '#FEF3C7', color: '#D97706' },
  system: { Icon: SettingsIcon, bg: '#F3F4F6', color: '#6B7280' },
  general: { Icon: Bell, bg: '#F3F4F6', color: '#6B7280' },
};

function getTypeIcon(type?: string) {
  return (type && TYPE_ICONS[type]) || TYPE_ICONS.general;
}

// Localize tuition + salary notifications. Default English title/body strings
// are fixed on the backend; admin-customized fees_reminder text is shown
// as-is.
function localizeTuition(
  type: string | undefined,
  title: string,
  message: string,
  t: (k: string, opts?: any) => string,
): { title: string; message: string } {
  if (type === 'payment_recorded') {
    const m = /^Payment of (.+) received$/.exec(message);
    return {
      title: t('notifications.payment_recorded_title'),
      message: m ? t('notifications.payment_recorded_body', { amount: m[1] }) : message,
    };
  }
  if (type === 'fees_reminder') {
    const isDefaultTitle = title === 'Tuition payment reminder';
    const isDefaultBody = message === 'A tuition payment is due. Please contact the school for details.';
    return {
      title: isDefaultTitle ? t('notifications.fees_reminder_title') : title,
      message: isDefaultBody ? t('notifications.fees_reminder_body') : message,
    };
  }
  if (type === 'salary_paid') {
    const m = /^Salary of (\S+) (\S+) recorded(?: for (.+))?$/.exec(message);
    return {
      title: t('notifications.salary_paid_title'),
      message: m
        ? (m[3]
          ? t('notifications.salary_paid_body_period', { amount: m[1], currency: m[2], period: m[3] })
          : t('notifications.salary_paid_body', { amount: m[1], currency: m[2] }))
        : message,
    };
  }
  if (type === 'salary_due_soon') {
    const m = /^Your salary of (\S+) (\S+) is due (.+?)\. Please visit/.exec(message);
    return {
      title: t('notifications.salary_due_title'),
      message: m
        ? t('notifications.salary_due_body', { amount: m[1], currency: m[2], when: m[3] })
        : message,
    };
  }
  return { title, message };
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
  const {
    items, setItems, loading, loadingMore, onScroll,
  } = usePaginated<Notification>(parentApi.getNotifications);

  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);

  useEffect(() => {
    parentApi.markAllRead().catch(() => {});
    setUnreadCount(0);
  }, [setUnreadCount]);

  const markRead = async (id: string) => {
    await parentApi.markRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handlePress = (item: Notification) => {
    if (!item.isRead) markRead(item.id);
    openNotificationTarget({ type: item.notificationType, relatedId: item.relatedId });
  };

  const displayedGroups = useMemo(() => groupByDay(items), [items]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('notifications.title')}</Text>
        <Text style={styles.subtitle}>{t('notifications.subtitle')}</Text>
      </View>

      {loading ? (
        <CardListSkeleton count={5} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('notifications.no_notifications')}</Text>
      ) : (
        <>
          {displayedGroups.map(group => (
            <View key={group.label}>
              <Text style={styles.dayLabel}>{group.label}</Text>
              {group.items.map(item => {
                const { Icon, bg, color } = getTypeIcon(item.notificationType);
                const { title, message } = localizeTuition(item.notificationType, item.title, item.message, t);
                return (
                  <TouchableOpacity key={item.id} activeOpacity={0.75}
                    style={[styles.card, !item.isRead && styles.cardUnread]}
                    onPress={() => handlePress(item)}>
                    <View style={styles.cardRow}>
                      <View style={[styles.iconBox, { backgroundColor: bg }]}>
                        <Icon size={18} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
                          {!item.isRead && <View style={styles.dot} />}
                        </View>
                        <Text style={styles.cardMessage} numberOfLines={2}>{message}</Text>
                        <Text style={[styles.cardTime, { marginTop: 8 }]}>{formatTime(item.createdAt)}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          {loadingMore && (
            <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.primary} />
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
  cardRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  cardTitle: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
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
