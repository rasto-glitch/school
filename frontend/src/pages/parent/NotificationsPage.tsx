import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { NotificationListSkeleton } from '../../components/common/Skeleton';
import type { Notification } from '../../types';
import { format, parseISO, isToday, isYesterday } from 'date-fns';

function groupByDate(notifications: Notification[], t: (key: string) => string) {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const d = parseISO(n.createdAt);
    const label = isToday(d) ? t('common.today') : isYesterday(d) ? t('common.yesterday') : format(d, 'MMMM d, yyyy');
    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  }
  return groups;
}

const typeColors: Record<string, string> = {
  homework: 'bg-blue-50 text-blue-600',
  assignment: 'bg-green-50 text-green-600',
  bus: 'bg-amber-50 text-amber-600',
  grade: 'bg-purple-50 text-purple-600',
  announcement: 'bg-pink-50 text-pink-600',
  general: 'bg-gray-50 text-gray-600',
};

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
    parentApi.getNotifications()
      .then(r => setNotifications(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [retryKey]);

  const markRead = async (id: string) => {
    await parentApi.markRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const groups = groupByDate(notifications, t);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <PageLayout title={t('notifications.title')} subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}>
      {loading ? <NotificationListSkeleton /> : error ? (
        <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
      ) : notifications.length === 0 ? (
        <EmptyState title={t('notifications.no_notifications')} icon={<Bell className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([date, items]) => (
            <div key={date}>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{date}</h2>
              <div className="space-y-2">
                {items.map((n) => (
                  <Card key={n.id} className={`${!n.isRead ? 'border-primary-200 bg-primary-50/30' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${typeColors[n.notificationType] || typeColors.general}`}>
                        <Bell className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{n.title}</p>
                          {!n.isRead && (
                            <button onClick={() => markRead(n.id)} className="p-1 hover:bg-white rounded-lg flex-shrink-0" title="Mark as read">
                              <Check className="w-3 h-3 text-primary-600" />
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                        <p className="text-xs text-gray-400 mt-1">{format(parseISO(n.createdAt), 'h:mm a')}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
