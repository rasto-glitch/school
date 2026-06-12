import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Globe, Mail, Lock, Loader2, LogOut, ShieldCheck, Copy, CheckCircle2, Monitor, Trash2, Download, Activity, Phone, PhoneCall } from 'lucide-react';
import { authApi, mfaApi, trustedDeviceApi, sessionsApi, phoneOtpApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import { downloadRecoveryCodes } from '../../utils/downloadCodes';
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
  const { user, school, setEmail: setStoreEmail, setPhone: setStorePhone, logout } = useAuthStore() as any;
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

  // Trusted devices (Phase 3). Listed only when MFA is active, since
  // without MFA the concept of "trusted device" has no meaning.
  type TrustedDevice = { id: string; device_label: string | null; user_agent: string | null; ip: string | null; created_at: string; last_seen_at: string; expires_at: string };
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[] | null>(null);
  const [trustedLoading, setTrustedLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Active sessions (refresh-token families). Independent of MFA — every
  // logged-in user has at least one session.
  type Session = { familyId: string; deviceLabel: string; userAgent: string | null; ip: string | null; createdAt: string; lastActivityAt: string; expiresAt: string };
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

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

  // Phone verification state machine (migration 050, Stage B). Locally
  // tracks the editable draft + the pending-confirmation state. Mirrors
  // the email flow above.
  const [phoneDraft, setPhoneDraft] = useState<string>(user?.phoneE164 || '');
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [phoneResendCooldown, setPhoneResendCooldown] = useState(0);

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

  // Pull the canonical email + phone state from the server every time
  // the modal opens. Without this the modal shows whatever was cached
  // at login time — admin-set phones and cross-device verifies are
  // missed otherwise.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    authApi.getMe()
      .then(r => {
        if (cancelled) return;
        setStoreEmail(r.data.email ?? null);
        setStorePhone(r.data.phoneE164 ?? null, r.data.phoneVerifiedAt ?? null);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [isOpen, setStoreEmail, setStorePhone]);

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
  const refreshTrustedDevices = async () => {
    setTrustedLoading(true);
    try {
      const r = await trustedDeviceApi.list();
      setTrustedDevices(r.data.devices || []);
    } catch {
      setTrustedDevices([]);
    } finally {
      setTrustedLoading(false);
    }
  };

  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const r = await sessionsApi.list();
      setSessions(r.data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  const onRevokeSession = async (familyId: string) => {
    setRevokingSessionId(familyId);
    try {
      await sessionsApi.revoke(familyId);
      setSessions((prev) => (prev || []).filter((s) => s.familyId !== familyId));
      toast.success(t('sessions.revoke_success', 'Session signed out.'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('sessions.revoke_failed', 'Could not sign out session.'));
    } finally {
      setRevokingSessionId(null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshMfaStatus();
      void refreshTrustedDevices();
      void refreshSessions();
      setMfaShowDisable(false);
      setMfaShowRegen(false);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaRegenCode('');
      setMfaNewCodes(null);
    }
  }, [isOpen]);

  const onRevokeTrustedDevice = async (id: string) => {
    setRevokingId(id);
    try {
      await trustedDeviceApi.revoke(id);
      setTrustedDevices((prev) => (prev || []).filter((d) => d.id !== id));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.trust_revoke_failed', 'Could not revoke device.'));
    } finally {
      setRevokingId(null);
    }
  };

  const onRevokeAllTrusted = async () => {
    if (!window.confirm(t('mfa.trust_revoke_all_confirm', 'Forget every trusted browser for this account?'))) return;
    setRevokingId('all');
    try {
      await trustedDeviceApi.revokeAll();
      setTrustedDevices([]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.trust_revoke_failed', 'Could not revoke devices.'));
    } finally {
      setRevokingId(null);
    }
  };

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

  // ── Phone verification handlers (migration 050 / Stage B) ──
  const submitPhoneSend = async () => {
    const trimmed = phoneDraft.trim();
    if (!trimmed) {
      toast.error(t('account_settings.phone_required', 'Phone number is required.'));
      return;
    }
    setPhoneSubmitting(true);
    try {
      const res = await phoneOtpApi.sendVerify(trimmed);
      setPendingPhone(trimmed);
      setPhoneCode('');
      setPhoneResendCooldown(RESEND_COOLDOWN_SECONDS);
      if (res.data?.deliveryAttempted?.whatsapp) {
        toast.success(t('account_settings.phone_code_sent_whatsapp', 'Verification code sent via WhatsApp.'));
      } else if (res.data?.deliveryAttempted?.emailFallbackImmediate) {
        toast.success(t('account_settings.phone_code_sent_email', 'WhatsApp delivery is unavailable; we emailed you the code instead.'));
      } else {
        toast.info(t('account_settings.phone_code_sending', 'Sending your verification code…'));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('account_settings.phone_send_failed', 'Could not send verification code.'));
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const submitPhoneCode = async () => {
    if (!/^\d{6}$/.test(phoneCode)) {
      toast.error(t('account_settings.code_invalid_format', 'Enter the 6-digit code.'));
      return;
    }
    setPhoneVerifying(true);
    try {
      const res = await phoneOtpApi.confirmVerify(phoneCode);
      const verifiedAt = res.data?.verifiedAt || new Date().toISOString();
      setStorePhone(pendingPhone || phoneDraft, verifiedAt);
      setPendingPhone(null);
      setPhoneCode('');
      toast.success(t('account_settings.phone_verified', 'Phone verified.'));
    } catch (err: any) {
      const data = err.response?.data;
      toast.error(data?.error || t('account_settings.phone_verify_failed', 'Could not verify code.'));
      if (data?.error?.toLowerCase?.().includes('expired') || data?.error?.toLowerCase?.().includes('too many')) {
        setPendingPhone(null);
        setPhoneCode('');
      }
    } finally {
      setPhoneVerifying(false);
    }
  };

  const cancelPhonePending = () => {
    setPendingPhone(null);
    setPhoneCode('');
    setPhoneDraft(user?.phoneE164 || '');
  };

  // Resend cooldown ticker for the phone flow — mirrors the email one.
  useEffect(() => {
    if (phoneResendCooldown <= 0) return;
    const id = setInterval(() => setPhoneResendCooldown(n => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [phoneResendCooldown]);

  // Sync phoneDraft from the auth store whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setPhoneDraft(user?.phoneE164 || '');
      setPendingPhone(null);
      setPhoneCode('');
      setPhoneResendCooldown(0);
    }
  }, [isOpen, user?.phoneE164]);

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

        {/* Phone verification (migration 050, Stage B). WhatsApp via OTPIQ;
            email fallback if WhatsApp delivery fails. Iraqi (+964) only. */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Phone className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.phone_section', 'Phone number')}
            </h3>
            {user?.phoneE164 && user?.phoneVerifiedAt && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                <CheckCircle2 className="w-3 h-3" />
                {t('account_settings.phone_verified_chip', 'Verified')}
              </span>
            )}
          </div>

          {pendingPhone ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-900">
                  {t('account_settings.phone_code_sent_to', 'We sent a 6-digit code to')}{' '}
                  <strong>{pendingPhone}</strong>.{' '}
                  {t('account_settings.phone_code_expires_in', 'It expires in 5 minutes.')}
                </p>
              </div>
              <Input
                label={t('account_settings.verification_code', 'Verification code')}
                value={phoneCode}
                onChange={e => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="tracking-[0.3em] font-mono text-center text-lg"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={submitPhoneCode} loading={phoneVerifying} disabled={phoneCode.length !== 6}>
                  {t('account_settings.verify', 'Verify')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={submitPhoneSend}
                  disabled={phoneResendCooldown > 0 || phoneSubmitting}
                >
                  {phoneSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {phoneResendCooldown > 0
                    ? `${t('account_settings.resend_in', 'Resend in')} ${phoneResendCooldown}s`
                    : t('account_settings.resend_code', 'Resend code')}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelPhonePending}>
                  {t('common.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                label={t('account_settings.phone_label', 'Iraqi mobile (+964)')}
                type="tel"
                value={phoneDraft}
                onChange={e => setPhoneDraft(e.target.value)}
                placeholder="0750 123 4567"
                autoComplete="tel"
                inputMode="tel"
                dir="ltr"
              />
              <p className="text-xs text-gray-500">
                <PhoneCall className="inline w-3 h-3 mr-1" />
                {t('account_settings.phone_hint', "We'll send a verification code via WhatsApp. Only Iraqi (+964) numbers are supported right now.")}
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={submitPhoneSend}
                  loading={phoneSubmitting}
                  disabled={!phoneDraft.trim()}
                >
                  {user?.phoneE164 && phoneDraft.trim() === user.phoneE164 && user?.phoneVerifiedAt
                    ? t('account_settings.phone_re_verify', 'Re-verify')
                    : t('account_settings.phone_send_code', 'Send code')}
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
                  <div className="flex justify-between items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => copyCodes(mfaNewCodes)}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
                      >
                        {mfaCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {mfaCopied ? t('mfa.copied', 'Copied') : t('mfa.copy_all_codes', 'Copy all codes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadRecoveryCodes(mfaNewCodes, { schoolName: school?.name, username: user?.username })}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
                      >
                        <Download className="w-4 h-4" /> {t('mfa.download_codes', 'Download as file')}
                      </button>
                    </div>
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
                <>
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

                  {/* Trusted devices subsection */}
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-gray-500" />
                        <h4 className="text-sm font-semibold text-gray-900">
                          {t('mfa.trust_section_title', 'Trusted devices')}
                        </h4>
                      </div>
                      {trustedDevices && trustedDevices.length > 0 && (
                        <button
                          type="button"
                          onClick={onRevokeAllTrusted}
                          disabled={revokingId === 'all'}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {t('mfa.trust_revoke_all', 'Revoke all')}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      {t('mfa.trust_section_body', "Browsers where you ticked 'Remember this browser' won't prompt for a code for 30 days. Revoke any you no longer recognize.")}
                    </p>
                    {trustedLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    ) : !trustedDevices || trustedDevices.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">
                        {t('mfa.trust_none', 'No trusted devices.')}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {trustedDevices.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {d.device_label || t('mfa.trust_unknown_device', 'Unknown device')}
                              </div>
                              <div className="text-xs text-gray-500">
                                {t('mfa.trust_last_seen', 'Last seen')}: {new Date(d.last_seen_at).toLocaleString()}
                                {d.ip ? ` · ${d.ip}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onRevokeTrustedDevice(d.id)}
                              disabled={revokingId === d.id}
                              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              {revokingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              {t('mfa.trust_revoke', 'Revoke')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
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

          {/* Active sessions subsection — one row per device family. */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-900">
                {t('sessions.section_title', 'Active sessions')}
              </h4>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {t('sessions.section_body', "Each row is a device you're currently signed in on. Sign out individual devices if you don't recognize one.")}
            </p>
            {sessionsLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            ) : !sessions || sessions.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                {t('sessions.none', 'No active sessions.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.familyId} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{s.deviceLabel}</div>
                      <div className="text-xs text-gray-500">
                        {t('sessions.started', 'Started')}: {new Date(s.createdAt).toLocaleString()}
                        {' · '}
                        {t('sessions.last_active', 'last active')} {new Date(s.lastActivityAt).toLocaleString()}
                        {s.ip ? ` · ${s.ip}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRevokeSession(s.familyId)}
                      disabled={revokingSessionId === s.familyId}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {revokingSessionId === s.familyId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                      {t('sessions.revoke', 'Sign out')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
