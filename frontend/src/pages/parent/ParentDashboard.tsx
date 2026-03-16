import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, MapPin, Bell, Calendar, FileText, Megaphone } from 'lucide-react';
import { parentApi, adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { DashboardSkeleton } from '../../components/common/Skeleton';
import type { Homework, Announcement, Assignment, Student } from '../../types';
import { format, parseISO, isToday, differenceInDays } from 'date-fns';

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [children, setChildren] = useState<Student[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
    Promise.allSettled([
      parentApi.getChildren(),
      parentApi.getHomework(),
      parentApi.getAssignments(),
      adminApi.getAnnouncements(),
    ]).then(([c, h, a, ann]) => {
      if (c.status === 'fulfilled') setChildren(c.value.data || []);
      if (h.status === 'fulfilled') setHomework((h.value.data || []).slice(0, 5));
      if (a.status === 'fulfilled') setAssignments((a.value.data || []).slice(0, 5));
      if (ann.status === 'fulfilled') setAnnouncements(ann.value.data || []);
      if ([c, h, a, ann].every(r => r.status === 'rejected')) setError(true);
    }).finally(() => setLoading(false));
  }, [retryKey]);

  if (loading) return <PageLayout title={t('dashboard.title')}><DashboardSkeleton /></PageLayout>;
  if (error) return <PageLayout title={t('dashboard.title')}><ErrorMessage onRetry={() => setRetryKey(k => k + 1)} /></PageLayout>;

  const feedItems = [
    ...announcements.map(a => ({ type: 'announcement', date: a.createdAt, data: a, path: `/parent/announcements/${a.id}` })),
    ...homework.map(h => ({ type: 'homework', date: h.createdAt, data: h, path: `/parent/homework/${h.id}` })),
    ...assignments.map(a => ({ type: 'assignment', date: a.createdAt, data: a, path: `/parent/assignments/${a.id}` })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const timeLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    const days = differenceInDays(new Date(), d);
    return isToday(d) ? t('common.today') : days === 1 ? t('common.yesterday') : t('common.days_ago', { count: days });
  };

  return (
    <PageLayout title={t('dashboard.title')} subtitle={t('dashboard.subtitle', { name: user?.firstName })}>
      <div className="space-y-5">
        {children.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {children.map(child => (
              <div key={child.id} className="flex items-center gap-2 px-3 py-1.5 bg-primary-50 rounded-full">
                <div className="w-6 h-6 bg-primary-200 rounded-full flex items-center justify-center">
                  <span className="text-primary-800 font-bold text-xs">{child.fullName?.[0]}</span>
                </div>
                <span className="text-sm font-medium text-primary-800">{child.fullName}</span>
                <span className="text-xs text-primary-400">{(child as any).classes?.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { to: '/parent/homework', icon: BookOpen, label: t('dashboard.quick_homework'), color: 'text-blue-600 bg-blue-50' },
            { to: '/parent/assignments', icon: ClipboardList, label: t('dashboard.quick_assignments'), color: 'text-green-600 bg-green-50' },
            { to: '/parent/reports', icon: FileText, label: t('dashboard.quick_reports'), color: 'text-purple-600 bg-purple-50' },
            { to: '/parent/bus', icon: MapPin, label: t('dashboard.quick_bus'), color: 'text-amber-600 bg-amber-50' },
            { to: '/parent/notifications', icon: Bell, label: t('dashboard.quick_alerts'), color: 'text-red-600 bg-red-50' },
            { to: '/parent/appointments', icon: Calendar, label: t('dashboard.quick_bookings'), color: 'text-teal-600 bg-teal-50' },
          ].map(({ to, icon: Icon, label, color }) => (
            <Link key={to} to={to}>
              <Card hover className="flex flex-col items-center gap-1.5 py-3 text-center">
                <div className={`p-2 rounded-xl ${color}`}><Icon className="w-4 h-4" /></div>
                <span className="text-xs font-semibold text-gray-900">{label}</span>
              </Card>
            </Link>
          ))}
        </div>

        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('dashboard.latest_activity')}</h2>
          {feedItems.length === 0 ? (
            <EmptyState title={t('dashboard.no_activity')} />
          ) : (
            <div className="space-y-3">
              {feedItems.map((item, i) => {
                if (item.type === 'announcement') {
                  const ann = item.data as Announcement;
                  return (
                    <Card key={`a${i}`} hover onClick={() => navigate(item.path)}>
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-purple-50 rounded-xl flex-shrink-0"><Megaphone className="w-4 h-4 text-purple-600" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <Badge color="primary">{t('dashboard.badge_announcement')}</Badge>
                            <span className="text-xs text-gray-400">{timeLabel(ann.createdAt)}</span>
                          </div>
                          <h3 className="font-semibold text-gray-900 text-sm">{ann.title}</h3>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2 leading-relaxed">{ann.content}</p>
                        </div>
                      </div>
                    </Card>
                  );
                }
                if (item.type === 'assignment') {
                  const a = item.data as Assignment;
                  return (
                    <Card key={`as${i}`} hover onClick={() => navigate(item.path)}>
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-green-50 rounded-xl flex-shrink-0"><ClipboardList className="w-4 h-4 text-green-600" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <Badge color="green">{t('dashboard.badge_assignment')}</Badge>
                            <span className="text-xs text-gray-400">{timeLabel(a.createdAt)}</span>
                          </div>
                          <h3 className="font-semibold text-gray-900 text-sm">{a.title}</h3>
                          {a.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{a.description}</p>}
                          <div className="flex items-center gap-3 mt-1.5">
                            {a.subject && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{a.subject}</span>}
                            {a.dueDate && <span className="text-xs text-gray-400">{t('common.due')}: {format(parseISO(a.dueDate), 'MMM d')}</span>}
                            {a.grade != null && <span className="text-xs font-semibold text-primary-600">{t('common.grade')}: {a.grade}</span>}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                }
                const hw = item.data as Homework;
                return (
                  <Card key={`h${i}`} hover onClick={() => navigate(item.path)}>
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-blue-50 rounded-xl flex-shrink-0"><BookOpen className="w-4 h-4 text-blue-600" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <Badge color="secondary">{t('dashboard.badge_homework')}</Badge>
                          <span className="text-xs text-gray-400">{timeLabel(hw.createdAt)}</span>
                        </div>
                        <h3 className="font-semibold text-gray-900 text-sm">{hw.title}</h3>
                        {hw.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{hw.description}</p>}
                        <div className="flex items-center gap-3 mt-1.5">
                          {hw.subject && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{hw.subject}</span>}
                          {hw.dueDate && <span className="text-xs text-gray-400">{t('common.due')}: {format(parseISO(hw.dueDate), 'MMM d')}</span>}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
