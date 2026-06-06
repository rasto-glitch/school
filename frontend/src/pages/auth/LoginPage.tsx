import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn, ShieldCheck, ArrowLeft, Copy, CheckCircle2, Loader2, Download } from 'lucide-react';
import { toast } from 'react-toastify';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { getTrustedDeviceToken, setTrustedDeviceToken, clearTrustedDeviceToken } from '../../utils/trustedDevice';
import { downloadRecoveryCodes } from '../../utils/downloadCodes';
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
  const [rememberDevice, setRememberDevice] = useState(false);
  // Username that the password step matched — needed so the trusted-
  // device persistence keys by user, and the MFA-verify response can
  // store the new token against the right account.
  const [mfaUsername, setMfaUsername] = useState<string | null>(null);

  // Phase 2 forced enrollment state. Same idea as mfaTicket but the
  // exchange path is different: the user enrolls (QR + 6-digit confirm)
  // and the confirm step issues tokens.
  const [enrollTicket, setEnrollTicket] = useState<string | null>(null);
  const [enrollUsername, setEnrollUsername] = useState<string | null>(null);
  const [enrollData, setEnrollData] = useState<{ qrDataUrl: string; secret: string; recoveryCodes: string[] } | null>(null);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollConfirming, setEnrollConfirming] = useState(false);
  const [enrollStep, setEnrollStep] = useState<'scan' | 'recovery'>('scan');
  const [enrollAck, setEnrollAck] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

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
      const trustedToken = getTrustedDeviceToken(data.username);
      const res = await authApi.login(data.username, data.password, trustedToken);
      // MFA-required users: server returns a ticket instead of tokens.
      if (res.data?.mfaRequired && res.data?.mfaTicket) {
        setMfaTicket(res.data.mfaTicket);
        setMfaRemember(!!data.rememberMe);
        setMfaUsername(data.username);
        setMfaCode('');
        setRememberDevice(false);
        return;
      }
      // Phase 2: school requires MFA for this role, user isn't enrolled.
      if (res.data?.mfaEnrollmentRequired && res.data?.enrollmentTicket) {
        setEnrollTicket(res.data.enrollmentTicket);
        setMfaRemember(!!data.rememberMe);
        setEnrollUsername(data.username);
        setRememberDevice(false);
        setEnrollStep('scan');
        setEnrollAck(false);
        setEnrollCode('');
        // Kick off setup so we have a QR ready by the time the panel renders.
        setEnrollLoading(true);
        try {
          const s = await authApi.enrollMfaSetup(res.data.enrollmentTicket);
          setEnrollData({ qrDataUrl: s.data.qrDataUrl, secret: s.data.secret, recoveryCodes: s.data.recoveryCodes });
        } catch (err: any) {
          toast.error(err.response?.data?.error || t('auth.mfa_failed'));
          setEnrollTicket(null);
        } finally {
          setEnrollLoading(false);
        }
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
      const res = await authApi.verifyMfaLogin(mfaTicket, trimmed, rememberDevice);
      const { token, refreshToken, user, school, trustedDeviceToken } = res.data;
      // Persist the trusted-device token BEFORE setAuth so a re-render
      // chain triggered by setAuth can read it if needed. Keyed by the
      // username we logged in with so a shared browser keeps separate
      // tokens per account.
      if (trustedDeviceToken && mfaUsername) {
        setTrustedDeviceToken(mfaUsername, trustedDeviceToken);
      }
      setAuth(token, refreshToken, user, school, mfaRemember);
      navigate(ROLE_DASHBOARDS[user.role] || '/');
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error;
      toast.error(msg || t('auth.mfa_failed', 'Could not verify code.'));
      if (status === 401 && msg && /sign in again/i.test(msg)) {
        setMfaTicket(null);
        setMfaCode('');
        // Drop a possibly-stale trusted token so the next attempt isn't
        // poisoned by it.
        if (mfaUsername) clearTrustedDeviceToken(mfaUsername);
      }
    } finally {
      setMfaVerifying(false);
    }
  };

  const cancelMfa = () => {
    setMfaTicket(null);
    setMfaCode('');
    setMfaUsername(null);
    setRememberDevice(false);
  };

  const copyText = async (text: string, marker: 'secret' | 'codes') => {
    try {
      await navigator.clipboard.writeText(text);
      if (marker === 'secret') { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
      else { setCopiedCodes(true); setTimeout(() => setCopiedCodes(false), 2000); }
    } catch { /* clipboard not permitted */ }
  };

  const onEnrollConfirm = async () => {
    if (!enrollTicket) return;
    if (!/^\d{6}$/.test(enrollCode)) {
      toast.error(t('auth.mfa_code_required', 'Enter the 6-digit code from your authenticator app.'));
      return;
    }
    setEnrollConfirming(true);
    try {
      const res = await authApi.enrollMfaConfirm(enrollTicket, enrollCode, rememberDevice);
      const { token, refreshToken, user, school, trustedDeviceToken } = res.data;
      if (trustedDeviceToken && enrollUsername) {
        setTrustedDeviceToken(enrollUsername, trustedDeviceToken);
      }
      setAuth(token, refreshToken, user, school, mfaRemember);
      navigate(ROLE_DASHBOARDS[user.role] || '/');
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.error;
      toast.error(msg || t('auth.mfa_failed', 'Could not verify code.'));
      if (status === 401 && msg && /sign in again/i.test(msg)) {
        setEnrollTicket(null);
        setEnrollData(null);
      }
    } finally {
      setEnrollConfirming(false);
    }
  };

  const cancelEnroll = () => {
    setEnrollTicket(null);
    setEnrollData(null);
    setEnrollCode('');
    setEnrollUsername(null);
    setRememberDevice(false);
    setEnrollStep('scan');
    setEnrollAck(false);
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
          {enrollTicket ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-primary-700" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">{t('auth.mfa_enroll_title', 'Set up two-factor to continue')}</h2>
                  <p className="text-xs text-gray-500">{t('auth.mfa_enroll_subtitle', 'Your school requires two-factor authentication. Scan the QR with your authenticator app and enter the code below.')}</p>
                </div>
              </div>

              {enrollLoading || !enrollData ? (
                <div className="py-10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                </div>
              ) : enrollStep === 'scan' ? (
                <>
                  <div className="flex flex-col items-center gap-3 py-1">
                    <img src={enrollData.qrDataUrl} alt="MFA QR" className="w-[200px] h-[200px] rounded-xl border border-gray-200" />
                    <div className="w-full">
                      <div className="text-xs font-semibold text-gray-500 mb-1">{t('mfa.manual_key_label', "Can't scan? Enter this key manually:")}</div>
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-gray-900 break-all">{enrollData.secret}</code>
                        <button
                          type="button"
                          onClick={() => copyText(enrollData.secret, 'secret')}
                          className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800"
                        >
                          {copiedSecret ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copiedSecret ? t('mfa.copied', 'Copied') : t('mfa.copy', 'Copy')}
                        </button>
                      </div>
                    </div>
                  </div>
                  <Input
                    label={t('mfa.code_label', '6-digit code from your app')}
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="tracking-[0.3em] font-mono text-center text-lg"
                  />
                  <Button
                    type="button"
                    onClick={() => { if (/^\d{6}$/.test(enrollCode)) setEnrollStep('recovery'); else toast.error(t('mfa.code_invalid_format', 'Enter the 6-digit code.')); }}
                    fullWidth
                    disabled={enrollCode.length !== 6}
                  >
                    {t('mfa.confirm_action', 'Confirm and continue')}
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-sm text-amber-900 font-semibold mb-1">{t('mfa.recovery_save_title', 'Save these recovery codes')}</p>
                    <p className="text-xs text-amber-800">{t('mfa.recovery_save_body', "These are the only way to sign in if you lose your authenticator. They won't be shown again. Each code works once.")}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3 max-h-44 overflow-auto">
                    {enrollData.recoveryCodes.map((c, i) => (
                      <div key={i} className="font-mono text-sm text-gray-900 tracking-wider">{c}</div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => copyText(enrollData.recoveryCodes.join('\n'), 'codes')}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
                    >
                      {copiedCodes ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedCodes ? t('mfa.copied', 'Copied') : t('mfa.copy_all_codes', 'Copy all codes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadRecoveryCodes(enrollData.recoveryCodes, { username: enrollUsername ?? undefined })}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
                    >
                      <Download className="w-4 h-4" /> {t('mfa.download_codes', 'Download as file')}
                    </button>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enrollAck}
                      onChange={(e) => setEnrollAck(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">{t('mfa.recovery_ack', 'I have saved these recovery codes somewhere safe.')}</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">{t('auth.remember_device_30d', 'Remember this browser for 30 days')}</span>
                  </label>
                  <Button
                    type="button"
                    onClick={onEnrollConfirm}
                    fullWidth
                    loading={enrollConfirming}
                    disabled={!enrollAck}
                    icon={<LogIn className="w-4 h-4" />}
                  >
                    {t('mfa.finish_action', 'Finish setup')}
                  </Button>
                </>
              )}
              <button
                type="button"
                onClick={cancelEnroll}
                className="w-full inline-flex items-center justify-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 mt-1"
              >
                <ArrowLeft className="w-4 h-4" /> {t('auth.mfa_back', 'Back to sign in')}
              </button>
            </div>
          ) : mfaTicket ? (
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
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
                <span className="text-sm text-gray-600">{t('auth.remember_device_30d', 'Remember this browser for 30 days')}</span>
              </label>
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
