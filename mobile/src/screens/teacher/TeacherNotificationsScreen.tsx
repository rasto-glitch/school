import { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { usePaginated } from '../../hooks/usePaginated';
import { Bell, CheckCircle, Wallet } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import { openNotificationTarget } from '../../utils/notificationNav';

interface Notif { id: string; title: string; message?: string; isRead: boolean; createdAt: string; notificationType?: string; relatedId?: string }

const TYPE_ICONS: Record<string, { Icon: any; bg: string; color: string }> = {
  salary_paid: { Icon: Wallet, bg: '#DCFCE7', color: '#16A34A' },
  salary_due_soon: { Icon: Wallet, bg: '#FEF3C7', color: '#D97706' },
};

function localizeSalary(
  type: string | undefined,
  title: string,
  message: string,
  t: (k: string, opts?: any) => string,
): { title: string; message: string } {
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

export default function TeacherNotificationsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const {
    items: notifications, setItems, loading, loadingMore, refreshing, refresh, onScroll,
  } = usePaginated<Notif>(teacherApi.getNotifications);
  const [marking, setMarking] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markRead = async (id: string) => {
    setMarking(id);
    try {
      await teacherApi.markNotificationRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } finally {
      setMarking(null);
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await teacherApi.markAllRead();
      setItems(prev => prev.map(n => ({ ...n, isRead: true })));
    } finally {
      setMarkingAll(false);
    }
  };

  const groupLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d, yyyy');
  };

  const grouped: { label: string; items: Notif[] }[] = [];
  notifications.forEach(n => {
    const label = groupLabel(n.createdAt);
    const existing = grouped.find(g => g.label === label);
    if (existing) existing.items.push(n);
    else grouped.push({ label, items: [n] });
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markAllBtn} onPress={markAll} disabled={markingAll}>
            {markingAll
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={styles.markAllText}>Mark all read</Text>}
          </TouchableOpacity>
        )}
      </View>
      {unreadCount > 0 && <Text style={styles.unreadLabel}>{unreadCount} unread</Text>}

      {loading ? (
        <CardListSkeleton count={5} />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <Bell size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>No notifications yet.</Text>
        </View>
      ) : (
        <>
        {grouped.map(({ label, items }) => (
          <View key={label}>
            <Text style={styles.groupLabel}>{label}</Text>
            {items.map(n => {
              const typed = TYPE_ICONS[n.notificationType ?? ''];
              const Icon = typed?.Icon ?? Bell;
              const iconBg = typed?.bg ?? (n.isRead ? colors.bg : colors.primaryLight);
              const iconColor = typed?.color ?? (n.isRead ? colors.textMuted : colors.primary);
              const { title, message } = localizeSalary(n.notificationType, n.title, n.message ?? '', t);
              const handleTap = () => {
                if (!n.isRead) markRead(n.id);
                openNotificationTarget({ type: n.notificationType, relatedId: n.relatedId });
              };
              return (
                <TouchableOpacity key={n.id} activeOpacity={0.75} onPress={handleTap} style={[styles.card, !n.isRead && styles.cardUnread]}>
                  <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
                    <Icon size={16} color={iconColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, !n.isRead && styles.cardTitleUnread]}>{title}</Text>
                    {message ? <Text style={styles.cardMsg} numberOfLines={2}>{message}</Text> : null}
                    <Text style={styles.cardTime}>{format(parseISO(n.createdAt), 'h:mm a')}</Text>
                  </View>
                  {!n.isRead && (
                    <TouchableOpacity onPress={() => markRead(n.id)} disabled={marking === n.id} style={styles.checkBtn}>
                      {marking === n.id
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <CheckCircle size={20} color={colors.primary} />}
                    </TouchableOpacity>
                  )}
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

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text },
  markAllBtn: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  markAllText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  unreadLabel: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.md },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  groupLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: font.sm, fontWeight: '500', color: colors.textSecondary },
  cardTitleUnread: { fontWeight: '700', color: colors.text },
  cardMsg: { fontSize: font.xs, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  cardTime: { fontSize: font.xs, color: colors.textMuted, marginTop: 4 },
  checkBtn: { padding: 4 },
});
