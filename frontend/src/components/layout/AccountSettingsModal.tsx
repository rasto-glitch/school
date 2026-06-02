import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Globe, Mail, Lock, Loader2 } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import Modal from '../common/Modal';
import Input from '../common/Input';
import Button from '../common/Button';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PwForm = { currentPassword: string; newPassword: string; confirmPassword: string };

const RESEND_COOLDOWN_SECONDS = 30;

export default function AccountSettingsModal({ isOpen, onClose }: AccountSettingsModalProps) {
  const { t, i18n } = useTranslation();
  const { user, setEmail: setStoreEmail } = useAuthStore();
  const [changing, setChanging] = useState(false);
  const { register, handleSubmit, reset } = useForm<PwForm>();

  // Email change state machine
  const [emailDraft, setEmailDraft] = useState(user?.email || '');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Reset email draft when modal opens or user changes
  useEffect(() => {
    if (isOpen) {
      setEmailDraft(user?.email || '');
      setPendingEmail(null);
      setCode('');
      setResendCooldown(0);
    }
  }, [isOpen, user?.email]);

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
    setEmailSubmitting(true);
    try {
      const res = await authApi.updateMyEmail(trimmed);
      const { pending, email: applied } = res.data || {};
      if (pending) {
        setPendingEmail(trimmed);
        setCode('');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        toast.success(t('account_settings.code_sent', 'Verification code sent. Check your inbox.'));
      } else {
        setStoreEmail(applied || trimmed);
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
              <p className="text-xs text-gray-500">
                {user?.email
                  ? t('account_settings.email_change_hint', 'Changing your email sends a 6-digit code to the new address to confirm.')
                  : t('account_settings.email_first_hint', "We'll save this immediately since there's no current email on file.")}
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={submitEmail}
                  loading={emailSubmitting}
                  disabled={!emailDraft.trim() || emailDraft.trim().toLowerCase() === (user?.email || '').toLowerCase()}
                >
                  {t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          )}
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
    </Modal>
  );
}
