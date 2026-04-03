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
    `flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all ${
      isActive
        ? 'text-primary-700 bg-primary-50'
        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
    }`;

  return (
    <nav className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-gray-200/60">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mr-2">
          {school?.logoUrl ? (
            <img src={school.logoUrl} alt={school.name} className="w-8 h-8 rounded-lg object-cover ring-2 ring-gray-100" />
          ) : (
            <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md shadow-primary-200">
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
          )}
          <div className="hidden sm:block">
            <span className="font-bold text-gray-900 text-sm leading-tight block">
              {school?.name || 'Academic Portal'}
            </span>
            <span className="text-[10px] text-gray-400 font-medium leading-tight block -mt-0.5">Academic Portal</span>
          </div>
        </div>

        {/* Nav links */}
        <div className="flex items-center gap-1 flex-1">
          <NavLink to="/feed" className={linkCls}>
            <FileText className="w-3.5 h-3.5" />Posts
          </NavLink>
          <NavLink to="/ebooks" className={linkCls}>
            <Library className="w-3.5 h-3.5" />E-Books
          </NavLink>
          {user?.role === 'teacher' && (
            <NavLink to="/my-posts" className={linkCls}>
              <BookOpen className="w-3.5 h-3.5" />My Posts
            </NavLink>
          )}
        </div>

        {/* User + logout */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-50 ring-2 ring-gray-100">
              <span className="text-[10px] font-bold text-primary-700">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-gray-700 leading-tight">
                {user?.firstName} {user?.lastName}
              </span>
              <span className="text-[10px] text-gray-400 capitalize leading-tight">{user?.role}</span>
            </div>
          </div>
          <div className="w-px h-6 bg-gray-200 hidden sm:block" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 group"
          >
            <LogOut className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
            <span className="hidden sm:block font-medium">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
