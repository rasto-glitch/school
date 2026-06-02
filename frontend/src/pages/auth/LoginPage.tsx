import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn, ShieldCheck, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';

const schema = z.object({
  username: z.string().min(1, 'auth.username_required'),
  password: z.string().min(1, 'auth.password_required'),
  rememberMe: z.boolean(),
});

type FormData = z.infer<typeof schema>;

const ROLE_DASHBOARDS: Record<string, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  driver: '/driver/dashboard',
  supervisor: '/supervisor/dashboard',
  reception: '/reception/dashboard',
  accountant: '/accounting',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setAuth, isAuthenticated, user } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  // MFA step state. When the password step returns mfaRequired, we hold
  // the rememberMe choice + ticket and switch the form into MFA-code mode.
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRemember, setMfaRemember] = useState(false);
  const [mfaVerifying, setMfaVerifying] = useState(false);

  useEffect(() => {
    if (isAuthenticated() && user) {
      navigate(ROLE_DASHBOARDS[user.role] || '/admin/dashboard', { replace: true });
    }
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { rememberMe: false },
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await authApi.login(data.username, data.password);
      // MFA-required users: server returns a ticket instead of tokens.
      // Switch into the code-entry step; rememberMe is held until the
      // ticket is exchanged so the final setAuth uses the user's choice.
      if (res.data?.mfaRequired && res.data?.mfaTicket) {
        setMfaTicket(res.data.mfaTicket);
        setMfaRemember(!!data.rememberMe);
        setMfaCode('');
        return;
      }
      const { token, refreshToken, user, school } = res.data;
      setAuth(token, refreshToken, user, school, data.rememberMe);
      navigate(ROLE_DASHBOARDS[user.role] || '/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.login_failed'));
    } finally {
      setLoading(false);
    }
  };

  const onMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaTicket) return;
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      toast.error(t('auth.mfa_code_required', 'Enter the 6-digit code from your authenticator app.'));
      return;
    }
    setMfaVerifying(true);
    try {
      const res = await authApi.verifyMfaLogin(mfaTicket, trimmed);
      const { token, refreshToken, user, school } = res.data;
      setAuth(token, refreshToken, user, school, mfaRemember);
      navigate(ROLE_DASHBOARDS[user.role] || '/');
    } catch (err: any) {
      // 401 on expired ticket means we drop back to step 1
      const status = err.response?.status;
      const msg = err.response?.data?.error;
      toast.error(msg || t('auth.mfa_failed', 'Could not verify code.'));
      if (status === 401 && msg && /sign in again/i.test(msg)) {
        setMfaTicket(null);
        setMfaCode('');
      }
    } finally {
      setMfaVerifying(false);
    }
  };

  const cancelMfa = () => {
    setMfaTicket(null);
    setMfaCode('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mx-auto mb-4 rounded-2xl bg-primary-700/60 ring-1 ring-white/20 shadow-[0_0_40px_rgba(255,255,255,0.35)] backdrop-blur-sm">
            <img src="/splash-s.png" alt="Scholify" className="w-12 h-12" />
          </div>
          <h1 className="text-3xl font-bold text-white">Scholify</h1>
          <p className="text-primary-200 mt-1">{t('auth.subtitle')}</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {mfaTicket ? (
            <form onSubmit={onMfaVerify} className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-primary-700" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">{t('auth.mfa_title', 'Two-factor verification')}</h2>
                  <p className="text-xs text-gray-500">{t('auth.mfa_subtitle', 'Enter the 6-digit code from your authenticator app, or use a recovery code.')}</p>
                </div>
              </div>
              <Input
                label={t('auth.mfa_code_label', 'Authentication code')}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className="tracking-[0.3em] font-mono text-center text-lg"
              />
              <Button
                type="submit"
                fullWidth
                loading={mfaVerifying}
                icon={<LogIn className="w-4 h-4" />}
              >
                {t('auth.mfa_verify_action', 'Verify and sign in')}
              </Button>
              <button
                type="button"
                onClick={cancelMfa}
                className="w-full inline-flex items-center justify-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 mt-1"
              >
                <ArrowLeft className="w-4 h-4" /> {t('auth.mfa_back', 'Back to sign in')}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label={t('auth.username')}
              placeholder={t('auth.username_ph')}
              error={errors.username?.message && t(errors.username.message)}
              autoComplete="username"
              {...register('username')}
            />
            <div className="relative">
              <Input
                label={t('auth.password')}
                type={showPass ? 'text' : 'password'}
                placeholder={t('auth.password_ph')}
                error={errors.password?.message && t(errors.password.message)}
                autoComplete="current-password"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Remember Me */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                {...register('rememberMe')}
              />
              <span className="text-sm text-gray-600">{t('auth.remember_me')}</span>
            </label>

            <Button
              type="submit"
              fullWidth
              loading={loading}
              icon={<LogIn className="w-4 h-4" />}
              className="mt-2"
            >
              {t('auth.sign_in')}
            </Button>

            <div className="text-center mt-3">
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
              >
                {t('auth.forgot_password')}
              </button>
            </div>
          </form>
          )}

          <p className="text-center text-xs text-gray-400 mt-6">
            {t('auth.contact_admin')}
          </p>
        </div>
      </div>
    </div>
  );
}
