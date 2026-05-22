import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { supervisorApi } from '../../services/api';
import { GroupedVirtuoso } from 'react-virtuoso';
import { usePaginated } from '../../hooks/usePaginated';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
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

export default function SupervisorNotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    items: notifications, setItems, loading, loadingMore, loadMore,
  } = usePaginated<Notification>(supervisorApi.getNotifications);

  const markRead = async (id: string) => {
    await supervisorApi.markNotificationRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllRead = async () => {
    await supervisorApi.markAllRead();
    setItems(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const handlePress = (n: Notification) => {
    if (!n.isRead) markRead(n.id);
    switch (n.notificationType) {
      case 'homework':
        navigate('/supervisor/homework');
        break;
      case 'assignment':
        navigate('/supervisor/assignments');
        break;
      case 'report':
        navigate('/supervisor/student-reports');
        break;
      case 'weekly_summary':
        navigate('/supervisor/weekly-summary');
        break;
      case 'attendance':
        navigate('/supervisor/attendance');
        break;
      case 'chat':
        navigate('/chat');
        break;
    }
  };

  const groups = groupByDate(notifications, t);
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const entries = Object.entries(groups);
  const groupLabels = entries.map(([label]) => label);
  const groupCounts = entries.map(([, items]) => items.length);
  const flat = entries.flatMap(([, items]) => items);

  return (
    <PageLayout title={t('nav.notifications')} subtitle={unreadCount > 0 ? t('notifications.unread', { count: unreadCount }) : t('notifications.all_caught_up')}>
      {unreadCount > 0 && (
        <div className="flex justify-end mb-4">
          <button onClick={markAllRead} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
            <CheckCheck className="w-4 h-4" /> {t('notifications.mark_all_read')}
          </button>
        </div>
      )}
      {loading ? <LoadingSpinner /> : notifications.length === 0 ? (
        <EmptyState title={t('notifications.none')} icon={<Bell className="w-8 h-8 text-gray-400" />} />
      ) : (
        <GroupedVirtuoso
          useWindowScroll
          groupCounts={groupCounts}
          endReached={loadMore}
          components={{
            Footer: () => loadingMore
              ? <p className="py-3 text-center text-sm text-gray-400">{t('common.loading_more')}</p>
              : null,
          }}
          groupContent={(index) => (
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider py-2 bg-gray-50">
              {groupLabels[index]}
            </div>
          )}
          itemContent={(index) => {
            const n = flat[index];
            return (
              <Card hover onClick={() => handlePress(n)} className={`mb-2 ${!n.isRead ? 'border-primary-200 bg-primary-50/30' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary-50 rounded-lg flex-shrink-0">
                    <Bell className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{n.title}</p>
                      {!n.isRead && (
                        <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className="p-1 hover:bg-white rounded-lg flex-shrink-0">
                          <Check className="w-3 h-3 text-primary-600" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{format(parseISO(n.createdAt), 'h:mm a')}</p>
                  </div>
                </div>
              </Card>
            );
          }}
        />
      )}
    </PageLayout>
  );
}
