import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { GraduationCap, ArrowLeft, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { authApi } from '../../services/api';
import Input from '../../components/common/Input';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
});
type FormData = z.infer<typeof schema>;

// Two reset paths offered side-by-side:
//   1. Email link  — only works if the user has an email on file. Backend
//      returns success unconditionally to prevent enumeration.
//   2. Admin reset — files a request the school admin sees in their panel.

type Status = 'idle' | 'sending' | 'sent';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
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
      setServerError('Could not reach the server. Please try again.');
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
      setServerError('Could not reach the server. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <GraduationCap className="w-9 h-9 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Forgot password?</h1>
          <p className="text-primary-200 mt-1">Pick how you'd like to reset it.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-4">
          <form onSubmit={handleSubmit(sendEmailLink)} className="space-y-4">
            <Input
              label="Username"
              placeholder="e.g. fisk_username"
              error={errors.username?.message}
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
                    ? 'Sending…'
                    : emailStatus === 'sent'
                      ? 'Link sent — check your inbox'
                      : 'Email me a reset link'}
                </span>
                <span className="block text-xs text-white/85">Works if you have an email on file</span>
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
                  ? 'Sending…'
                  : adminStatus === 'sent'
                    ? 'Request sent to your admin'
                    : 'Ask my school admin'}
              </span>
              <span className="block text-xs text-gray-500">Works for everyone, even without an email</span>
            </span>
          </button>

          {(emailStatus === 'sent' || adminStatus === 'sent') && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              {emailStatus === 'sent' && (
                <p>If your account has an email on file, a reset link is on its way. The link expires in 1 hour.</p>
              )}
              {adminStatus === 'sent' && (
                <p>Your school administrator will reset your password and contact you.</p>
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
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
