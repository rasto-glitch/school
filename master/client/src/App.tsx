import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import SchoolsPage from './pages/SchoolsPage';
import ChatAuditPage from './pages/ChatAuditPage';
import InboxPage from './pages/InboxPage';

export type MasterView = 'schools' | 'audit' | 'inbox';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<MasterView>('schools');

  useEffect(() => {
    const stored = localStorage.getItem('master_token');
    if (stored) setToken(stored);
  }, []);

  const handleLogin = (t: string) => {
    localStorage.setItem('master_token', t);
    setToken(t);
  };

  const handleLogout = () => {
    localStorage.removeItem('master_token');
    setToken(null);
  };

  if (!token) return <LoginPage onLogin={handleLogin} />;

  if (view === 'audit') {
    return <ChatAuditPage onLogout={handleLogout} currentView={view} onNavigate={setView} />;
  }
  if (view === 'inbox') {
    return <InboxPage onLogout={handleLogout} currentView={view} onNavigate={setView} />;
  }
  return <SchoolsPage onLogout={handleLogout} currentView={view} onNavigate={setView} />;
}
