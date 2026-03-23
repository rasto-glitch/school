import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Calendar, FileText, Megaphone, FileBadge } from 'lucide-react';
import { parentApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { DashboardSkeleton } from '../../components/common/Skeleton';
import type { Announcement, Student } from '../../types';
import { parseISO, isToday, differenceInDays } from 'date-fns';

export default function ParentDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [children, setChildren] = useState<Student[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
    Promise.allSettled([
      parentApi.getChildren(),
      parentApi.getAnnouncements(),
    ]).then(([c, ann]) => {
      if (c.status === 'fulfilled') setChildren(c.value.data || []);
      if (ann.status === 'fulfilled') setAnnouncements(ann.value.data || []);
      if ([c, ann].every(r => r.status === 'rejected')) setError(true);
    }).finally(() => setLoading(false));
  }, [retryKey]);

  if (loading) return <PageLayout title={t('dashboard.title')}><DashboardSkeleton /></PageLayout>;
  if (error) return <PageLayout title={t('dashboard.title')}><ErrorMessage onRetry={() => setRetryKey(k => k + 1)} /></PageLayout>;

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

        <div className="grid grid-cols-3 gap-2">
          {[
            { to: '/parent/reports', icon: FileText, label: t('dashboard.quick_reports'), color: 'text-purple-600 bg-purple-50' },
            { to: '/parent/grades', icon: FileBadge, label: t('dashboard.quick_grades') || 'Grades', color: 'text-indigo-600 bg-indigo-50' },
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
          {announcements.length === 0 ? (
            <EmptyState title={t('dashboard.no_activity')} />
          ) : (
            <div className="space-y-3">
              {announcements.map((ann, i) => (
                <Card key={`a${i}`} hover onClick={() => navigate(`/parent/announcements/${ann.id}`)}>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
