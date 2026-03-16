import { Bell, Menu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Link } from 'react-router-dom';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick: () => void;
}

export default function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const { user } = useAuthStore();

  const notifPath = user?.role === 'parent' ? '/parent/notifications' : undefined;

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {notifPath && (
          <Link to={notifPath} className="p-2 rounded-xl hover:bg-gray-100 transition-colors relative">
            <Bell className="w-5 h-5 text-gray-600" />
          </Link>
        )}
        <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center">
          {user?.profilePicture ? (
            <img src={user.profilePicture} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-primary-700">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
