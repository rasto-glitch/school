import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import api from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Notification } from '../../types';
import { format, parseISO, isToday, isYesterday } from 'date-fns';

function groupByDate(notifications: Notification[]) {
  const groups: Record<string, Notification[]> = {};
  for (const n of notifications) {
    const d = parseISO(n.createdAt);
    const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  }
  return groups;
}

export default function TeacherNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications')
      .then(r => setNotifications(r.data || []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const groups = groupByDate(notifications);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <PageLayout title="Notifications" subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}>
      {loading ? <LoadingSpinner /> : notifications.length === 0 ? (
        <EmptyState title="No notifications" icon={<Bell className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([date, items]) => (
            <div key={date}>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{date}</h2>
              <div className="space-y-2">
                {items.map(n => (
                  <Card key={n.id} className={!n.isRead ? 'border-primary-200 bg-primary-50/30' : ''}>
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-primary-50 rounded-lg flex-shrink-0">
                        <Bell className="w-4 h-4 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{n.title}</p>
                          {!n.isRead && (
                            <button onClick={() => markRead(n.id)} className="p-1 hover:bg-white rounded-lg flex-shrink-0">
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
