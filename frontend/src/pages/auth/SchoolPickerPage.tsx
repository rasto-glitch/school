import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Search } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import LoadingSpinner from '../../components/common/LoadingSpinner';

const ROLE_DASHBOARDS: Record<string, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  driver: '/driver/dashboard',
  supervisor: '/supervisor/dashboard',
};

export default function SchoolPickerPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const [schools, setSchools] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated() && user) {
      navigate(ROLE_DASHBOARDS[user.role] || '/admin/dashboard', { replace: true });
      return;
    }
    authApi.getSchools()
      .then(r => setSchools(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? schools.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : schools;

  const pick = (school: any) => {
    // Pass school via navigation state — NOT stored until after successful login
    navigate('/login', { state: { school } });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <GraduationCap className="w-9 h-9 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">School Portal</h1>
          <p className="text-primary-200 mt-1">Select your school to continue</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6">
          {/* Search */}
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Search for your school…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="py-10"><LoadingSpinner /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-10">No schools found.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
              {filtered.map(school => (
                <button
                  key={school.id}
                  onClick={() => pick(school)}
                  className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-all text-left group"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-100 group-hover:bg-primary-200 transition-colors">
                    {school.logoUrl ? (
                      <img src={school.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover" />
                    ) : (
                      <GraduationCap className="w-5 h-5 text-primary-600" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{school.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
