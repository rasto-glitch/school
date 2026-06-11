import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import PreLoginLanguageSwitcher from '../../components/auth/PreLoginLanguageSwitcher';

// Force-change-password screen. Reached automatically by the route
// guard in App.tsx whenever the authenticated user has
// mustChangePassword=true on their stored profile. Until they submit a
// new password, every other route bounces them back here.
//
// The language switcher is rendered prominently — a parent / driver /
// teacher who reads only Arabic or Kurdish needs to understand WHY they
// can't reach the dashboard. Without it they'd see a wall of English
// and quite reasonably conclude "the login is broken."
const ROLE_DASHBOARDS: Record<string, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  driver: '/driver/dashboard',
  supervisor: '/supervisor/dashboard',
  reception: '/reception/dashboard',
  accountant: '/accounting',
};

export default function ForceChangePasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, setAuth, token, refreshToken, school, rememberMe, logout } = useAuthStore();

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirm) {
      toast.error(t('force_change.both_required', 'Enter and confirm your new password.'));
      return;
    }
    if (newPassword !== confirm) {
      toast.error(t('profile.passwords_no_match', 'Passwords do not match'));
      return;
    }
    if (!isStrongPassword(newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.firstTimeChangePassword(newPassword);
      // Update the locally-cached user so the guard stops sending us here.
      if (user && token && refreshToken && school) {
        setAuth(token, refreshToken, { ...user, mustChangePassword: false }, school, rememberMe);
      }
      toast.success(t('force_change.success', 'Password changed. Welcome.'));
      navigate(ROLE_DASHBOARDS[user?.role || ''] || '/', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('force_change.failed', 'Could not change password.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <PreLoginLanguageSwitcher />
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {t('force_change.title', 'Choose a new password')}
              </h1>
              <p className="text-xs text-gray-500">
                {t('force_change.subtitle', 'One-time setup for your account')}
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-700 mb-4">
            {t(
              'force_change.body',
              'For your security, the temporary password you just used cannot be kept. Pick a new password to continue.',
            )}
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              type={showNew ? 'text' : 'password'}
              label={t('force_change.new_password', 'New password')}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
              icon={
                <button type="button" onClick={() => setShowNew(s => !s)} aria-label="toggle">
                  {showNew ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
                </button>
              }
            />

            <Input
              type={showConfirm ? 'text' : 'password'}
              label={t('force_change.confirm', 'Confirm new password')}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              icon={
                <button type="button" onClick={() => setShowConfirm(s => !s)} aria-label="toggle">
                  {showConfirm ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
                </button>
              }
            />

            <p className="text-xs text-gray-500">
              {t('force_change.policy_hint', PASSWORD_POLICY_MESSAGE)}
            </p>

            <Button type="submit" loading={submitting} className="w-full">
              {t('force_change.submit', 'Set new password')}
            </Button>

            <button
              type="button"
              onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className="block w-full text-center text-xs text-gray-500 hover:text-gray-700 underline mt-2"
            >
              {t('force_change.sign_out', 'Sign out')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
