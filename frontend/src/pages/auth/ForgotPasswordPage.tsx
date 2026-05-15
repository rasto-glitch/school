import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { GraduationCap, ArrowLeft, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { authApi } from '../../services/api';
import Input from '../../components/common/Input';

const schema = z.object({
  username: z.string().min(1, 'auth.username_required'),
});
type FormData = z.infer<typeof schema>;

// Two reset paths offered side-by-side:
//   1. Email link  — only works if the user has an email on file. Backend
//      returns success unconditionally to prevent enumeration.
//   2. Admin reset — files a request the school admin sees in their panel.

type Status = 'idle' | 'sending' | 'sent';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [emailStatus, setEmailStatus] = useState<Status>('idle');
  const [adminStatus, setAdminStatus] = useState<Status>('idle');
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const sendEmailLink = async (data: FormData) => {
    setServerError('');
    setEmailStatus('sending');
    try {
      await authApi.forgotPasswordEmail(data.username);
      setEmailStatus('sent');
    } catch {
      // Backend always returns 200; this catches only network errors.
      setEmailStatus('idle');
      setServerError(t('auth.server_error'));
    }
  };

  const sendAdminRequest = async () => {
    const username = getValues('username');
    if (!username) return;
    setServerError('');
    setAdminStatus('sending');
    try {
      await authApi.forgotPassword(username);
      setAdminStatus('sent');
    } catch {
      setAdminStatus('idle');
      setServerError(t('auth.server_error'));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <GraduationCap className="w-9 h-9 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{t('auth.forgot_title')}</h1>
          <p className="text-primary-200 mt-1">{t('auth.forgot_subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-4">
          <form onSubmit={handleSubmit(sendEmailLink)} className="space-y-4">
            <Input
              label={t('auth.username')}
              placeholder={t('auth.username_ph')}
              error={errors.username?.message && t(errors.username.message)}
              autoComplete="username"
              {...register('username')}
            />

            <button
              type="submit"
              disabled={emailStatus === 'sending' || emailStatus === 'sent'}
              className="w-full flex items-center gap-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3.5 transition-colors"
            >
              <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-white/15">
                {emailStatus === 'sent'
                  ? <CheckCircle2 className="w-5 h-5" />
                  : <Mail className="w-5 h-5" />}
              </span>
              <span className="flex-1 text-left">
                <span className="block text-sm font-semibold">
                  {emailStatus === 'sending'
                    ? t('auth.sending')
                    : emailStatus === 'sent'
                      ? t('auth.email_sent_btn')
                      : t('auth.email_btn')}
                </span>
                <span className="block text-xs text-white/85">{t('auth.email_hint')}</span>
              </span>
            </button>
          </form>

          <button
            type="button"
            onClick={sendAdminRequest}
            disabled={adminStatus === 'sending' || adminStatus === 'sent'}
            className="w-full flex items-center gap-3 bg-white border border-gray-200 hover:border-gray-300 disabled:opacity-60 disabled:cursor-not-allowed text-gray-900 rounded-xl px-4 py-3.5 transition-colors"
          >
            <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-gray-100">
              {adminStatus === 'sent'
                ? <CheckCircle2 className="w-5 h-5 text-primary-600" />
                : <ShieldCheck className="w-5 h-5 text-primary-600" />}
            </span>
            <span className="flex-1 text-left">
              <span className="block text-sm font-semibold">
                {adminStatus === 'sending'
                  ? t('auth.sending')
                  : adminStatus === 'sent'
                    ? t('auth.admin_sent_btn')
                    : t('auth.admin_btn')}
              </span>
              <span className="block text-xs text-gray-500">{t('auth.admin_hint')}</span>
            </span>
          </button>

          {(emailStatus === 'sent' || adminStatus === 'sent') && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              {emailStatus === 'sent' && (
                <p>{t('auth.email_sent_note')}</p>
              )}
              {adminStatus === 'sent' && (
                <p>{t('auth.admin_sent_note')}</p>
              )}
            </div>
          )}

          {serverError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              {serverError}
            </div>
          )}

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('auth.back_to_sign_in')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
