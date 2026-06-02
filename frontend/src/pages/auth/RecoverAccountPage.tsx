import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { authApi } from '../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';

type FormData = { newPassword: string; confirmPassword: string };

export default function RecoverAccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const { register, handleSubmit } = useForm<FormData>();

  const onSubmit = async (data: FormData) => {
    if (!token) {
      toast.error(t('recover.missing_token', 'This link is missing its token.'));
      return;
    }
    if (!isStrongPassword(data.newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (data.newPassword !== data.confirmPassword) {
      toast.error(t('profile.passwords_no_match', 'Passwords do not match'));
      return;
    }
    setSubmitting(true);
    try {
      await authApi.recoverAccount(token, data.newPassword);
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('recover.failed', 'Could not recover your account. The link may be expired or already used.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full mx-auto mb-3 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-green-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t('recover.done_title', 'Account recovered')}</h1>
          <p className="text-sm text-gray-600 mt-2">{t('recover.done_body', 'Your email has been reverted and a new password is set. All other devices have been signed out. Sign in to continue.')}</p>
          <Button onClick={() => navigate('/login')} className="mt-4">{t('recover.go_to_login', 'Go to login')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{t('recover.title', 'Recover your account')}</h1>
            <p className="text-xs text-gray-500">{t('recover.subtitle', 'Reset password and revert email')}</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 mb-4">
          {t('recover.explain', "Choose a new password. We'll reset it, revert your email to the address that received this alert, and sign you out everywhere.")}
        </p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <Input
            type="password"
            label={t('profile.new_password', 'New Password')}
            placeholder={t('profile.new_password_ph', 'Min 8 chars, 1 uppercase, 1 special character')}
            autoComplete="new-password"
            {...register('newPassword', { required: true })}
          />
          <Input
            type="password"
            label={t('profile.confirm_password', 'Confirm New Password')}
            autoComplete="new-password"
            {...register('confirmPassword', { required: true })}
          />
          <Button type="submit" loading={submitting} fullWidth>
            {t('recover.action', 'Reset password & revert email')}
          </Button>
        </form>
      </div>
    </div>
  );
}
