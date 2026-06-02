import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Globe, Mail, Lock, Loader2, LogOut, ShieldCheck, Copy, CheckCircle2 } from 'lucide-react';
import { authApi, mfaApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import Modal from '../common/Modal';
import Input from '../common/Input';
import Button from '../common/Button';
import MfaSetupModal from './MfaSetupModal';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PwForm = { currentPassword: string; newPassword: string; confirmPassword: string };

const RESEND_COOLDOWN_SECONDS = 30;

export default function AccountSettingsModal({ isOpen, onClose }: AccountSettingsModalProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, setEmail: setStoreEmail, logout } = useAuthStore();
  const [changing, setChanging] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const { register, handleSubmit, reset } = useForm<PwForm>();

  // MFA status (loaded on open) + setup / disable / regen state.
  const [mfaStatus, setMfaStatus] = useState<{ eligible: boolean; enrolled: boolean; confirmed: boolean; recoveryCodesRemaining: number } | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaSetupOpen, setMfaSetupOpen] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  const [mfaDisabling, setMfaDisabling] = useState(false);
  const [mfaShowDisable, setMfaShowDisable] = useState(false);
  const [mfaRegenCode, setMfaRegenCode] = useState('');
  const [mfaRegenerating, setMfaRegenerating] = useState(false);
  const [mfaShowRegen, setMfaShowRegen] = useState(false);
  const [mfaNewCodes, setMfaNewCodes] = useState<string[] | null>(null);
  const [mfaCopied, setMfaCopied] = useState(false);

  // Email change state machine
  const [emailDraft, setEmailDraft] = useState(user?.email || '');
  // Held across resends so the user doesn't have to re-type to refresh
  // the code. Wiped on success and on modal close so we never leave the
  // plaintext password sitting in component state longer than needed.
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Reset email draft when modal opens or user changes
  useEffect(() => {
    if (isOpen) {
      setEmailDraft(user?.email || '');
      setEmailPassword('');
      setPendingEmail(null);
      setCode('');
      setResendCooldown(0);
    }
  }, [isOpen, user?.email]);

  // Load MFA status whenever the modal opens. Eligible roles see the
  // section; for everyone else it's hidden so we don't fetch.
  const refreshMfaStatus = async () => {
    setMfaLoading(true);
    try {
      const res = await mfaApi.status();
      setMfaStatus(res.data);
    } catch {
      setMfaStatus(null);
    } finally {
      setMfaLoading(false);
    }
  };
  useEffect(() => {
    if (isOpen) {
      void refreshMfaStatus();
      setMfaShowDisable(false);
      setMfaShowRegen(false);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaRegenCode('');
      setMfaNewCodes(null);
    }
  }, [isOpen]);

  // Cooldown tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const onChangePassword = async (data: PwForm) => {
    if (!isStrongPassword(data.newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (data.newPassword !== data.confirmPassword) {
      toast.error(t('profile.passwords_no_match'));
      return;
    }
    setChanging(true);
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      toast.success(t('profile.password_changed'));
      reset();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('profile.password_change_failed'));
    } finally {
      setChanging(false);
    }
  };

  const submitEmail = async () => {
    const trimmed = emailDraft.trim().toLowerCase();
    if (!trimmed) {
      toast.error(t('account_settings.email_required', 'Email is required'));
      return;
    }
    if (trimmed === (user?.email || '').toLowerCase()) {
      toast.info(t('account_settings.email_unchanged', 'That is already your current email.'));
      return;
    }
    if (!emailPassword) {
      toast.error(t('account_settings.password_required', 'Enter your current password to confirm.'));
      return;
    }
    setEmailSubmitting(true);
    try {
      const res = await authApi.updateMyEmail(trimmed, emailPassword);
      const { pending, email: applied } = res.data || {};
      if (pending) {
        setPendingEmail(trimmed);
        setCode('');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        toast.success(t('account_settings.code_sent', 'Verification code sent. Check your inbox.'));
      } else {
        setStoreEmail(applied || trimmed);
        setEmailPassword('');
        toast.success(t('account_settings.email_saved', 'Email saved.'));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('account_settings.email_change_failed', 'Could not update email.'));
    } finally {
      setEmailSubmitting(false);
    }
  };

  const submitCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error(t('account_settings.code_invalid_format', 'Enter the 6-digit code.'));
      return;
    }
    setVerifying(true);
    try {
      const res = await authApi.verifyEmailCode(code);
      const newEmail = res.data?.email || pendingEmail;
      setStoreEmail(newEmail);
      setPendingEmail(null);
      setCode('');
      setEmailPassword('');
      toast.success(t('account_settings.email_saved', 'Email saved.'));
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.attemptsRemaining != null) {
        toast.error(`${data.error} (${data.attemptsRemaining} ${t('account_settings.attempts_remaining', 'attempts remaining')})`);
      } else {
        toast.error(data?.error || t('account_settings.code_verify_failed', 'Could not verify code.'));
        if (data?.error?.toLowerCase?.().includes('expired') || data?.error?.toLowerCase?.().includes('too many')) {
          // The token is dead; back out to the email-entry state
          setPendingEmail(null);
          setCode('');
        }
      }
    } finally {
      setVerifying(false);
    }
  };

  const cancelPending = () => {
    setPendingEmail(null);
    setCode('');
    setEmailDraft(user?.email || '');
    setEmailPassword('');
  };

  const onDisableMfa = async () => {
    if (!mfaDisablePassword || !/^\d{6}$/.test(mfaDisableCode)) {
      toast.error(t('mfa.disable_inputs_required', 'Enter your current password and a 6-digit code.'));
      return;
    }
    setMfaDisabling(true);
    try {
      await mfaApi.disableSelf(mfaDisablePassword, mfaDisableCode);
      toast.success(t('mfa.disable_success', 'Two-factor disabled.'));
      setMfaShowDisable(false);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      await refreshMfaStatus();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.disable_failed', 'Could not disable two-factor.'));
    } finally {
      setMfaDisabling(false);
    }
  };

  const onRegenerateRecovery = async () => {
    if (!/^\d{6}$/.test(mfaRegenCode)) {
      toast.error(t('mfa.code_invalid_format', 'Enter the 6-digit code.'));
      return;
    }
    setMfaRegenerating(true);
    try {
      const res = await mfaApi.regenerateRecoveryCodes(mfaRegenCode);
      setMfaNewCodes(res.data.recoveryCodes);
      setMfaRegenCode('');
      await refreshMfaStatus();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.regen_failed', 'Could not generate new recovery codes.'));
    } finally {
      setMfaRegenerating(false);
    }
  };

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setMfaCopied(true);
      setTimeout(() => setMfaCopied(false), 2000);
    } catch {
      toast.error(t('mfa.copy_failed', 'Could not copy to clipboard.'));
    }
  };

  // Revokes every refresh-token family for this user — including the
  // current session — so anyone signed in elsewhere is kicked the next
  // time their access token rotates (~15 min ceiling). To keep the UX
  // consistent we also tear down the local session immediately and bounce
  // to the login page rather than leave the user staring at a screen
  // whose refresh has already been killed server-side.
  const onSignOutEverywhere = async () => {
    if (!window.confirm(t(
      'account_settings.sign_out_all_confirm',
      'This signs you out on every device, including this one. Continue?',
    ))) return;
    setSigningOutAll(true);
    try {
      await authApi.logoutAll();
    } catch {
      // Even if the server call fails, clear the local session — the
      // user expressed intent to sign out and we shouldn't leave them
      // logged in with a stale UI.
    } finally {
      logout();
      onClose();
      navigate('/login', { replace: true });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('account_settings.title', 'Account Settings')} size="lg">
      <div className="space-y-6">
        {/* Language & region */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.language_section', 'Language & region')}
            </h3>
          </div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('account_settings.display_language', 'Display language')}
          </label>
          <select
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 cursor-pointer"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="ku">کوردی</option>
          </select>
        </section>

        {/* Account email */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.email_section', 'Account email')}
            </h3>
          </div>

          {pendingEmail ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-900">
                  {t('account_settings.code_sent_to', 'We sent a 6-digit code to')}{' '}
                  <strong>{pendingEmail}</strong>.{' '}
                  {t('account_settings.code_expires_in', 'It expires in 10 minutes.')}
                </p>
              </div>
              <Input
                label={t('account_settings.verification_code', 'Verification code')}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="tracking-[0.3em] font-mono text-center text-lg"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={submitCode} loading={verifying} disabled={code.length !== 6}>
                  {t('account_settings.verify', 'Verify')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={submitEmail}
                  disabled={resendCooldown > 0 || emailSubmitting}
                >
                  {emailSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {resendCooldown > 0
                    ? `${t('account_settings.resend_in', 'Resend in')} ${resendCooldown}s`
                    : t('account_settings.resend_code', 'Resend code')}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelPending}>
                  {t('common.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                label={t('account_settings.email_label', 'Email')}
                type="email"
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <Input
                label={t('account_settings.confirm_with_password', 'Confirm with current password')}
                type="password"
                value={emailPassword}
                onChange={e => setEmailPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <p className="text-xs text-gray-500">
                {user?.email
                  ? t('account_settings.email_change_hint', 'Changing your email sends a 6-digit code to the new address to confirm.')
                  : t('account_settings.email_first_hint', "We'll save this immediately since there's no current email on file.")}
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={submitEmail}
                  loading={emailSubmitting}
                  disabled={!emailDraft.trim() || !emailPassword || emailDraft.trim().toLowerCase() === (user?.email || '').toLowerCase()}
                >
                  {t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Two-factor authentication (admin + accountant only) */}
        {mfaStatus?.eligible && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('mfa.section_title', 'Two-factor authentication')}
            </h3>
          </div>

          {mfaLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          ) : !mfaStatus.confirmed ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {t('mfa.not_enrolled_body', 'Protect your sign-in with a 6-digit code from an authenticator app. You can use Google Authenticator, Authy, 1Password, or any TOTP app.')}
              </p>
              <Button onClick={() => setMfaSetupOpen(true)}>
                {t('mfa.enroll_action', 'Set up two-factor')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0" />
                <p className="text-sm text-green-900">
                  {t('mfa.enabled_summary', 'Two-factor authentication is enabled.')}{' '}
                  <span className="text-xs text-green-800">
                    {t('mfa.recovery_remaining', '{{count}} recovery codes left', { count: mfaStatus.recoveryCodesRemaining })}
                  </span>
                </p>
              </div>

              {mfaNewCodes ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-sm text-amber-900 font-semibold mb-1">
                      {t('mfa.recovery_save_title', 'Save these recovery codes')}
                    </p>
                    <p className="text-xs text-amber-800">
                      {t('mfa.recovery_save_body', "These are the only way to sign in if you lose your authenticator. They won't be shown again. Each code works once.")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-200 rounded-xl p-4">
                    {mfaNewCodes.map((c, i) => (
                      <div key={i} className="font-mono text-sm text-gray-900 tracking-wider">{c}</div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center">
                    <button
                      type="button"
                      onClick={() => copyCodes(mfaNewCodes)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
                    >
                      {mfaCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {mfaCopied ? t('mfa.copied', 'Copied') : t('mfa.copy_all_codes', 'Copy all codes')}
                    </button>
                    <Button variant="ghost" onClick={() => setMfaNewCodes(null)}>
                      {t('common.close', 'Close')}
                    </Button>
                  </div>
                </div>
              ) : mfaShowRegen ? (
                <div className="space-y-2 border border-gray-200 rounded-xl p-3">
                  <p className="text-sm text-gray-700">
                    {t('mfa.regen_body', 'Generate a new set of recovery codes. Your old codes will stop working.')}
                  </p>
                  <Input
                    label={t('mfa.code_label', '6-digit code from your app')}
                    value={mfaRegenCode}
                    onChange={(e) => setMfaRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="tracking-[0.3em] font-mono text-center"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setMfaShowRegen(false); setMfaRegenCode(''); }}>
                      {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button onClick={onRegenerateRecovery} loading={mfaRegenerating} disabled={mfaRegenCode.length !== 6}>
                      {t('mfa.regen_action', 'Generate new codes')}
                    </Button>
                  </div>
                </div>
              ) : mfaShowDisable ? (
                <div className="space-y-2 border border-red-200 rounded-xl p-3 bg-red-50/30">
                  <p className="text-sm text-red-900">
                    {t('mfa.disable_body', 'Turn off two-factor authentication. We require your current password and a code to confirm.')}
                  </p>
                  <Input
                    label={t('account_settings.confirm_with_password', 'Confirm with current password')}
                    type="password"
                    value={mfaDisablePassword}
                    onChange={(e) => setMfaDisablePassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <Input
                    label={t('mfa.code_label', '6-digit code from your app')}
                    value={mfaDisableCode}
                    onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="tracking-[0.3em] font-mono text-center"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setMfaShowDisable(false); setMfaDisablePassword(''); setMfaDisableCode(''); }}>
                      {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button
                      onClick={onDisableMfa}
                      loading={mfaDisabling}
                      disabled={!mfaDisablePassword || mfaDisableCode.length !== 6}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {t('mfa.disable_action', 'Disable two-factor')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={() => setMfaShowRegen(true)}>
                    {t('mfa.regen_open', 'Regenerate recovery codes')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setMfaShowDisable(true)}
                    className="border-red-300 text-red-700 hover:bg-red-50"
                  >
                    {t('mfa.disable_open', 'Disable two-factor')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
        )}

        {/* Sessions */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <LogOut className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.sessions_section', 'Active sessions')}
            </h3>
          </div>
          <p className="text-sm text-gray-700 mb-3">
            {t(
              'account_settings.sign_out_all_hint',
              "Lost a device, or think someone else is signed in? Sign out everywhere kicks every device — including this one — and forces a fresh login.",
            )}
          </p>
          <Button
            variant="outline"
            onClick={onSignOutEverywhere}
            loading={signingOutAll}
            className="border-red-300 text-red-700 hover:bg-red-50"
          >
            {t('account_settings.sign_out_all_action', 'Sign out everywhere')}
          </Button>
        </section>

        {/* Password */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('profile.change_password', 'Change Password')}
            </h3>
          </div>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3">
            <Input
              type="password"
              label={t('profile.current_password', 'Current Password')}
              autoComplete="current-password"
              {...register('currentPassword', { required: true })}
            />
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common.close', 'Close')}
              </Button>
              <Button type="submit" loading={changing}>
                {t('profile.update_password', 'Update Password')}
              </Button>
            </div>
          </form>
        </section>
      </div>
      <MfaSetupModal
        isOpen={mfaSetupOpen}
        onClose={() => setMfaSetupOpen(false)}
        onCompleted={() => void refreshMfaStatus()}
      />
    </Modal>
  );
}
