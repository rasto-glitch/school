import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Loader2, ShieldCheck } from 'lucide-react';
import Input from '../common/Input';
import Button from '../common/Button';
import { stepUpApi, type StepUpMethod, type StepUpProof } from '../../services/api';

// Step-up "prove it's you" prompt for sensitive contact changes
// (migration 051). Shown when the server answers a phone/email change with
// a step-up challenge. Lets the user prove ONE existing factor:
//   totp  → type an authenticator/recovery code (no send needed)
//   sms   → send a code to the CURRENT verified phone, then type it
//   email → send a code to the email on file, then type it
// On success it hands the proof back to the parent, which re-submits the
// original change request with it attached.
interface StepUpPromptProps {
  action: 'change_phone' | 'change_email';
  methods: StepUpMethod[];
  onProof: (proof: StepUpProof) => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function StepUpPrompt({ action, methods, onProof, onCancel, busy }: StepUpPromptProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<StepUpMethod>(methods[0] || 'totp');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const needsSend = method === 'sms' || method === 'email';

  const label = (m: StepUpMethod) =>
    m === 'totp' ? t('step_up.method_totp', 'Authenticator app')
      : m === 'sms' ? t('step_up.method_sms', 'Code to my current phone')
        : t('step_up.method_email', 'Code to my email');

  const pick = (m: StepUpMethod) => { setMethod(m); setCode(''); setSentTo(null); };

  const sendCode = async () => {
    if (!needsSend) return;
    setSending(true);
    try {
      const res = await stepUpApi.sendProof(action, method);
      setSentTo(res.data?.sentTo || null);
      toast.success(t('step_up.code_sent', 'Code sent to {{dest}}.', { dest: res.data?.sentTo || '' }));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('step_up.send_failed', 'Could not send the code. Try another method.'));
    } finally {
      setSending(false);
    }
  };

  const submit = () => {
    const c = code.trim();
    if (!c) { toast.error(t('step_up.code_required', 'Enter the verification code.')); return; }
    onProof({ method, code: c });
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-indigo-600" />
        <p className="text-sm font-semibold text-indigo-900">
          {t('step_up.title', "Verify it's really you")}
        </p>
      </div>
      <p className="text-xs text-indigo-800">
        {t('step_up.subtitle', 'For your security, this change needs one more check using a method already on your account.')}
      </p>

      {methods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {methods.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              className={`text-xs font-medium rounded-full px-3 py-1 border transition-colors ${
                method === m
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              {label(m)}
            </button>
          ))}
        </div>
      )}

      {needsSend && (
        <div className="space-y-1">
          <Button type="button" variant="outline" onClick={sendCode} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {sentTo ? t('step_up.resend', 'Resend code') : t('step_up.send', 'Send code')}
          </Button>
          {sentTo && (
            <p className="text-xs text-indigo-800">{t('step_up.sent_to', 'Code sent to {{dest}}.', { dest: sentTo })}</p>
          )}
        </div>
      )}

      <Input
        label={method === 'totp'
          ? t('step_up.totp_label', 'Authenticator or recovery code')
          : t('step_up.code_label', 'Verification code')}
        value={code}
        onChange={e => setCode(
          method === 'totp'
            ? e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 24)
            : e.target.value.replace(/\D/g, '').slice(0, 6),
        )}
        placeholder="123456"
        inputMode={method === 'totp' ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        dir="ltr"
        className="tracking-[0.2em] font-mono text-center text-lg"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={submit}
          loading={busy}
          disabled={!code.trim() || (needsSend && !sentTo)}
        >
          {t('step_up.verify_continue', 'Verify & continue')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
