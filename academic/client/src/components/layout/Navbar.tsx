import { NavLink, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, BookOpen, Library, FileText } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export default function Navbar() {
  const { user, school, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-primary-600' : 'text-gray-500 hover:text-gray-900'}`;

  return (
    <nav className="sticky top-0 z-20 bg-white border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mr-2">
          {school?.logoUrl ? (
            <img src={school.logoUrl} alt={school.name} className="w-7 h-7 rounded-lg object-cover" />
          ) : (
            <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="font-bold text-gray-900 text-sm hidden sm:block">
            {school?.name ? `${school.name} — Academic` : 'Academic Portal'}
          </span>
        </div>

        {/* Nav links */}
        <div className="flex items-center gap-5 flex-1">
          <NavLink to="/feed" className={linkCls}>
            <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />Posts</span>
          </NavLink>
          <NavLink to="/ebooks" className={linkCls}>
            <span className="flex items-center gap-1.5"><Library className="w-3.5 h-3.5" />E-Books</span>
          </NavLink>
          {user?.role === 'teacher' && (
            <NavLink to="/my-posts" className={linkCls}>
              <span className="flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" />My Posts</span>
            </NavLink>
          )}
        </div>

        {/* User + logout */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:block">
            {user?.firstName} {user?.lastName}
            <span className="ml-1.5 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs capitalize">{user?.role}</span>
          </span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:block">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
