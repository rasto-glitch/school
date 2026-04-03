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
    <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-4 sm:px-6 py-3.5 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5 text-gray-500" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {notifPath && (
          <Link to={notifPath} className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative">
            <Bell className="w-[18px] h-[18px] text-gray-500" />
          </Link>
        )}
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-50 ring-2 ring-gray-100">
          {user?.profilePicture ? (
            <img src={user.profilePicture} alt="" className="w-8 h-8 object-cover" />
          ) : (
            <span className="text-xs font-bold text-primary-700">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
