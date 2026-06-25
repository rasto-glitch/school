import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Search, GraduationCap, Users, Bus, ArrowRight } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ students: 0, teachers: 0, drivers: 0 });

  useEffect(() => {
    Promise.all([adminApi.getStudents(), adminApi.getTeachers('list'), adminApi.getDrivers()])
      .then(([s, t, d]) => setStats({
        students: s.data?.total || s.data?.students?.length || 0,
        teachers: t.data?.length || 0,
        drivers: d.data?.length || 0,
      }));
  }, []);

  const cards = [
    { to: '/admin/list/students', icon: GraduationCap, label: t('admin.students'), count: stats.students, light: 'bg-blue-50 text-blue-600' },
    { to: '/admin/list/teachers', icon: Users, label: t('admin.teachers'), count: stats.teachers, light: 'bg-green-50 text-green-600' },
    { to: '/admin/list/drivers', icon: Bus, label: t('admin.drivers'), count: stats.drivers, light: 'bg-amber-50 text-amber-600' },
  ];

  const quickLinks = [
    { to: '/admin/students', label: t('admin.manage_students'), desc: t('admin.manage_students_desc') },
    { to: '/admin/employees', label: t('admin.manage_employees'), desc: t('admin.manage_employees_desc') },
    { to: '/admin/drivers', label: t('admin.manage_drivers'), desc: t('admin.manage_drivers_desc') },
    { to: '/admin/accounts', label: t('admin.create_account'), desc: t('admin.create_account_desc') },
    { to: '/admin/appointments', label: t('nav.appointments'), desc: t('admin.appointments_desc') },
    { to: '/admin/classes', label: t('admin.classes'), desc: t('admin.classes_desc') },
    { to: '/admin/announcements', label: t('nav.announcements'), desc: t('admin.announcements_desc') },
  ];

  return (
    <PageLayout title={t('admin.dashboard_title')} subtitle={t('admin.welcome', { name: user?.firstName })}>
      <div className="space-y-6">
        {/* Search — press Enter to search students */}
        <form
          className="max-w-md flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (search.trim()) navigate(`/admin/list/students?search=${encodeURIComponent(search.trim())}`);
          }}
        >
          <div className="flex-1">
            <Input
              placeholder={t('admin.search_students_ph')}
              icon={<Search className="w-4 h-4" />}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {search.trim() && (
            <button
              type="submit"
              className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors whitespace-nowrap"
            >
              {t('common.search')} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {cards.map(({ to, icon: Icon, label, count, light }) => (
            <Link key={to} to={to}>
              <Card hover>
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${light}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{count}</p>
                    <p className="text-sm text-gray-500">{label}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick links */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('admin.management')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickLinks.map(({ to, label, desc }) => (
              <Link key={to} to={to}>
                <Card hover>
                  <h3 className="font-semibold text-gray-900 mb-1">{label}</h3>
                  <p className="text-sm text-gray-500">{desc}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
