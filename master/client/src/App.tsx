import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import SchoolsPage from './pages/SchoolsPage';

export default function App() {
  const [token, setToken] = useState<string | null>(null);

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
  return <SchoolsPage onLogout={handleLogout} />;
}
