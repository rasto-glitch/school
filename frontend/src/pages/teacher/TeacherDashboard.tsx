import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ClipboardList, FileText, Star, Clock, Users, LayoutGrid, ExternalLink } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Homework, Class } from '../../types';

export default function TeacherDashboard() {
  const { user } = useAuthStore();
  const [recentHW, setRecentHW] = useState<Homework[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleUrl, setScheduleUrl] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([teacherApi.getHomework(), teacherApi.getClasses(), teacherApi.getSchedule()])
      .then(([hw, cls, sched]) => {
        setRecentHW((hw.data || []).slice(0, 3));
        setClasses(cls.data || []);
        setScheduleUrl(sched.data?.scheduleUrl ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const actions = [
    { to: '/teacher/homework', icon: BookOpen, label: 'Write Homework', color: 'bg-blue-50 text-blue-600' },
    { to: '/teacher/assignments', icon: ClipboardList, label: 'Write Assignment', color: 'bg-green-50 text-green-600' },
    { to: '/teacher/reports', icon: FileText, label: 'Write Report', color: 'bg-purple-50 text-purple-600' },
    { to: '/teacher/grades', icon: Star, label: 'Enter Grades', color: 'bg-amber-50 text-amber-600' },
    { to: '/teacher/weekly-summary', icon: Clock, label: 'Weekly Summary', color: 'bg-pink-50 text-pink-600' },
    { to: '/teacher/students', icon: Users, label: 'My Students', color: 'bg-teal-50 text-teal-600' },
  ];

  if (loading) return <PageLayout title="Dashboard"><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title="Dashboard" subtitle={`Welcome, ${user?.firstName}!`}>
      <div className="space-y-6">
        {/* Classes */}
        {classes.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">My Classes</h2>
            <div className="flex flex-wrap gap-2">
              {classes.map(c => (
                <span key={c.id} className="px-3 py-1.5 bg-primary-50 text-primary-700 rounded-xl text-sm font-medium">{c.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {actions.map(({ to, icon: Icon, label, color }) => (
              <Link key={to} to={to}>
                <Card hover className="flex flex-col items-center gap-2 py-5 text-center">
                  <div className={`p-2.5 rounded-xl ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 leading-tight">{label}</span>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Schedule */}
        {scheduleUrl && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              <span className="flex items-center gap-2"><LayoutGrid className="w-4 h-4" />My Schedule</span>
            </h2>
            {scheduleUrl.match(/\.(jpg|jpeg|png|webp)$/i) ? (
              <Card className="overflow-hidden p-0">
                <img
                  src={scheduleUrl}
                  alt="Class Schedule"
                  className="w-full rounded-2xl object-contain max-h-[600px]"
                />
              </Card>
            ) : (
              <Card className="flex items-center gap-3">
                <LayoutGrid className="w-5 h-5 text-primary-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Class Schedule</p>
                  <p className="text-xs text-gray-500">PDF document</p>
                </div>
                <a
                  href={scheduleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary-600 font-medium hover:underline"
                >
                  Open <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Card>
            )}
          </div>
        )}

        {/* Recent homework */}
        {recentHW.length > 0 && (
          <Card>
            <h2 className="font-semibold text-gray-900 mb-3">Recently Posted Homework</h2>
            <div className="space-y-2">
              {recentHW.map(hw => (
                <div key={hw.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{hw.title}</p>
                    <p className="text-xs text-gray-500">{hw.subject} · {hw.classes?.name}</p>
                  </div>
                  {hw.dueDate && <span className="text-xs text-gray-400">Due {hw.dueDate}</span>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
