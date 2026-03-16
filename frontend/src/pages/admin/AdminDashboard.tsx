import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, GraduationCap, Users, Bus, ArrowRight } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ students: 0, teachers: 0, drivers: 0 });

  useEffect(() => {
    Promise.all([adminApi.getStudents(), adminApi.getTeachers(), adminApi.getDrivers()])
      .then(([s, t, d]) => setStats({
        students: s.data?.total || s.data?.students?.length || 0,
        teachers: t.data?.length || 0,
        drivers: d.data?.length || 0,
      }));
  }, []);

  const cards = [
    { to: '/admin/list/students', icon: GraduationCap, label: 'Students', count: stats.students, light: 'bg-blue-50 text-blue-600' },
    { to: '/admin/list/teachers', icon: Users, label: 'Teachers', count: stats.teachers, light: 'bg-green-50 text-green-600' },
    { to: '/admin/list/drivers', icon: Bus, label: 'Drivers', count: stats.drivers, light: 'bg-amber-50 text-amber-600' },
  ];

  const quickLinks = [
    { to: '/admin/students', label: 'Manage Students', desc: 'Add, edit, remove or assign students' },
    { to: '/admin/teachers', label: 'Manage Teachers', desc: 'Add, edit teachers and assign classes' },
    { to: '/admin/drivers', label: 'Manage Drivers', desc: 'Add, edit drivers and assign students' },
    { to: '/admin/accounts', label: 'Create Account', desc: 'Create user accounts for all roles' },
    { to: '/admin/appointments', label: 'Appointments', desc: 'View and respond to parent requests' },
    { to: '/admin/classes', label: 'Classes', desc: 'Manage class structure and weekly summaries' },
    { to: '/admin/announcements', label: 'Announcements', desc: 'Post announcements to parents and teachers' },
  ];

  return (
    <PageLayout title="Admin Dashboard" subtitle={`Welcome, ${user?.firstName}!`}>
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
              placeholder="Search students by name, address or phone… (press Enter)"
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
              Search <ArrowRight className="w-4 h-4" />
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Management</h2>
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
