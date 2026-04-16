import type { MasterView } from '../App';

interface Props {
  currentView: MasterView;
  onNavigate: (view: MasterView) => void;
  onLogout: () => void;
}

export default function MasterHeader({ currentView, onNavigate, onLogout }: Props) {
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-none">Master Portal</h1>
            <p className="text-xs text-slate-400 mt-0.5">Local access only</p>
          </div>
        </div>

        <nav className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <NavTab active={currentView === 'schools'} onClick={() => onNavigate('schools')}>Schools</NavTab>
          <NavTab active={currentView === 'audit'} onClick={() => onNavigate('audit')}>Chat Audit</NavTab>
        </nav>
      </div>

      <button
        onClick={onLogout}
        className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Logout
      </button>
    </header>
  );
}

function NavTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
