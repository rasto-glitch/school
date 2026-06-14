import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { mfaFactorsApi, type FactorStatus } from '../../services/api';
import Input from '../common/Input';
import Button from '../common/Button';

// "Use at sign-in" control for a phone/email login factor (Phase 3). Encapsulates
// the enable/disable handshake the backend requires: current password + a code
// sent to that channel. Lives inside the Phone and Account-email settings
// sections so it's reachable by every role (not just MFA-eligible staff).
type Props = {
  factor: 'phone' | 'email';
  status: FactorStatus;          // available / armed / preferred for this factor
  canEnable: boolean;            // email-not-solo precondition already satisfied
  multipleArmed: boolean;        // is "make default" meaningful?
  onChanged: (factors: FactorStatus[]) => void;
};

export default function LoginFactorToggle({ factor, status, canEnable, multipleArmed, onChanged }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'idle' | 'enable' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<'whatsapp' | 'email' | null>(null);

  const reset = () => { setMode('idle'); setPassword(''); setCode(''); setCodeSent(false); setChannel(null); };

  const sendCode = async () => {
    setSending(true);
    try {
      const res = await mfaFactorsApi.sendCode(factor);
      setChannel(res.data?.channel ?? (factor === 'phone' ? 'whatsapp' : 'email'));
      setCodeSent(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('login_factors.send_failed', 'Could not send a code.'));
    } finally { setSending(false); }
  };

  const submit = async () => {
    if (!password || !/^\d{6}$/.test(code)) {
      toast.error(t('login_factors.need_password_code', 'Enter your password and the 6-digit code.'));
      return;
    }
    setBusy(true);
    try {
      const res = mode === 'enable'
        ? await mfaFactorsApi.enable(factor, password, code)
        : await mfaFactorsApi.disable(factor, password, code);
      onChanged(res.data.factors);
      toast.success(mode === 'enable'
        ? t('login_factors.enabled', 'Sign-in codes turned on.')
        : t('login_factors.disabled', 'Sign-in codes turned off.'));
      reset();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('login_factors.failed', 'Could not update. Try again.'));
    } finally { setBusy(false); }
  };

  const makeDefault = async () => {
    try {
      const res = await mfaFactorsApi.setPreferred(factor);
      onChanged(res.data.factors);
      toast.success(t('login_factors.default_set', 'Set as your default sign-in method.'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('login_factors.failed', 'Could not update. Try again.'));
    }
  };

  // Channel not usable yet → nudge toward verifying it first.
  if (!status.available) {
    return (
      <p className="text-xs text-gray-500 mt-3">
        {factor === 'phone'
          ? t('login_factors.unavailable_phone', 'Verify your phone above to use it for sign-in.')
          : t('login_factors.unavailable_email', 'Add an email above to use it for sign-in.')}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3 bg-gray-50/60">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            {t('login_factors.use_at_signin', 'Use at sign-in')}
            {status.armed && status.preferred && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200">{t('login_factors.default', 'Default')}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {status.armed
              ? t('login_factors.on_hint', 'A code from this channel is required when you sign in.')
              : t('login_factors.off_hint', 'Turn on to require a code from this channel at sign-in.')}
          </div>
        </div>
        {mode === 'idle' && (
          <div className="flex-shrink-0">
            {status.armed ? (
              <button type="button" onClick={() => setMode('disable')} className="text-sm font-semibold text-red-600 hover:text-red-700">{t('login_factors.turn_off', 'Turn off')}</button>
            ) : (
              <button
                type="button"
                onClick={() => { if (!canEnable) { toast.info(t('login_factors.email_needs_partner', 'Add phone or an authenticator first — email can’t be your only sign-in code.')); return; } setMode('enable'); }}
                className="text-sm font-semibold text-primary-700 hover:text-primary-800"
              >
                {t('login_factors.turn_on', 'Turn on')}
              </button>
            )}
          </div>
        )}
      </div>

      {status.armed && !status.preferred && multipleArmed && mode === 'idle' && (
        <button type="button" onClick={makeDefault} className="mt-2 text-xs font-semibold text-primary-600 hover:text-primary-800">{t('login_factors.make_default', 'Make default')}</button>
      )}

      {mode !== 'idle' && (
        <div className="mt-3 space-y-2.5">
          <Input
            label={t('account_settings.confirm_with_password', 'Confirm with current password')}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {!codeSent ? (
            <Button type="button" variant="outline" onClick={sendCode} loading={sending} disabled={!password}>
              {t('login_factors.send_code', 'Send code')}
            </Button>
          ) : (
            <>
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs text-amber-900">
                  {channel === 'whatsapp' ? t('auth.login_otp_sent_whatsapp', 'We sent a code via WhatsApp.') : t('auth.login_otp_sent_email', 'We sent a code to your email.')}
                </p>
              </div>
              <Input
                label={t('account_settings.verification_code', 'Verification code')}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                dir="ltr"
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="tracking-[0.3em] font-mono text-center"
              />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset}>{t('common.cancel', 'Cancel')}</Button>
            {codeSent && (
              <Button
                type="button"
                onClick={submit}
                loading={busy}
                disabled={!password || code.length !== 6}
                className={mode === 'disable' ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                {mode === 'enable' ? t('login_factors.confirm_on', 'Turn on') : t('login_factors.confirm_off', 'Turn off')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
