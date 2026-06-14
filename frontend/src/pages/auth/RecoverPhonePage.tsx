import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/common/Button';
import PreLoginLanguageSwitcher from '../../components/auth/PreLoginLanguageSwitcher';

// Landing page for the "your phone number was changed" security alert.
// The token is the authorization; clicking through reverts the phone to
// the previous verified number and signs out every session (migration
// 051). Simpler than RecoverAccountPage — no new password is collected;
// reverting the phone + killing sessions is enough to cut off a hijacker.
export default function RecoverPhonePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onRevert = async () => {
    if (!token) {
      toast.error(t('recover.missing_token', 'This link is missing its token.'));
      return;
    }
    setSubmitting(true);
    try {
      await authApi.recoverPhone(token);
      // Clear any local auth left in this browser before showing done, so
      // "Go to login" doesn't bounce an authenticated session into the app.
      useAuthStore.getState().logout();
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('recover_phone.failed', 'Could not restore your number. The link may be expired or already used.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4"><PreLoginLanguageSwitcher />
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900">{t('recover.bad_link_title', 'Invalid recovery link')}</h1>
          <p className="text-sm text-gray-600 mt-2">{t('recover.bad_link_body', 'The link is missing its token. Use the link from the email exactly as sent.')}</p>
          <Link to="/login" className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-primary-700 hover:text-primary-800">
            <ArrowLeft className="w-4 h-4" /> {t('common.back', 'Back')}
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4"><PreLoginLanguageSwitcher />
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full mx-auto mb-3 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-green-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t('recover_phone.done_title', 'Phone number restored')}</h1>
          <p className="text-sm text-gray-600 mt-2">{t('recover_phone.done_body', 'Your previous phone number has been restored and every device has been signed out. If you didn\'t change it, also change your password from the sign-in screen.')}</p>
          <Button onClick={() => navigate('/login')} className="mt-4">{t('recover.go_to_login', 'Go to login')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4"><PreLoginLanguageSwitcher />
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{t('recover_phone.title', 'Restore your phone number')}</h1>
            <p className="text-xs text-gray-500">{t('recover_phone.subtitle', 'Undo a phone-number change')}</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 mb-4">
          {t('recover_phone.explain', "If you didn't change the phone number on your account, restore it here. We'll put your previous number back and sign out every device.")}
        </p>
        <Button onClick={onRevert} loading={submitting} fullWidth>
          {t('recover_phone.action', 'Restore my number & sign out everywhere')}
        </Button>
        <Link to="/login" className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-primary-700 hover:text-primary-800">
          <ArrowLeft className="w-4 h-4" /> {t('common.back', 'Back')}
        </Link>
      </div>
    </div>
  );
}
