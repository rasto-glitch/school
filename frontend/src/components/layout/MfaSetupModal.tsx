import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Copy, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { mfaApi } from '../../services/api';
import Modal from '../common/Modal';
import Input from '../common/Input';
import Button from '../common/Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

type Step = 'scan' | 'confirm' | 'recovery' | 'done';

interface SetupData {
  qrDataUrl: string;
  secret: string;
  recoveryCodes: string[];
}

export default function MfaSetupModal({ isOpen, onClose, onCompleted }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [data, setData] = useState<SetupData | null>(null);
  const [step, setStep] = useState<Step>('scan');
  const [code, setCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [acknowledgedCodes, setAcknowledgedCodes] = useState(false);

  // Defer the setup network call until the user actually opens the
  // modal — otherwise we'd churn through generated secrets every time
  // someone glances at settings.
  const startSetup = async () => {
    setLoading(true);
    try {
      const res = await mfaApi.setup();
      setData(res.data);
      setStep('scan');
      setCode('');
      setAcknowledgedCodes(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.setup_failed', 'Could not start two-factor setup.'));
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const onModalOpen = () => {
    if (isOpen && !data && !loading) void startSetup();
  };
  // useEffect-on-isOpen via a render-time guard is fine here — the
  // network call is idempotent enough (`data` blocks re-entry) and we
  // avoid an extra useEffect for one-shot setup.
  if (isOpen && !data && !loading) onModalOpen();

  const onConfirm = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error(t('mfa.code_invalid_format', 'Enter the 6-digit code.'));
      return;
    }
    setConfirming(true);
    try {
      await mfaApi.confirm(code);
      setStep('recovery');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('mfa.confirm_failed', 'Wrong code.'));
    } finally {
      setConfirming(false);
    }
  };

  const onFinish = () => {
    setData(null);
    setStep('scan');
    setCode('');
    setAcknowledgedCodes(false);
    onCompleted();
    onClose();
  };

  const handleClose = () => {
    setData(null);
    setStep('scan');
    setCode('');
    setAcknowledgedCodes(false);
    setCopiedSecret(false);
    setCopiedCodes(false);
    onClose();
  };

  const copyToClipboard = async (text: string, marker: 'secret' | 'codes') => {
    try {
      await navigator.clipboard.writeText(text);
      if (marker === 'secret') { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
      else { setCopiedCodes(true); setTimeout(() => setCopiedCodes(false), 2000); }
    } catch {
      toast.error(t('mfa.copy_failed', 'Could not copy to clipboard.'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('mfa.setup_title', 'Set up two-factor authentication')} size="lg">
      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
        </div>
      ) : !data ? null : step === 'scan' || step === 'confirm' ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-primary-700" />
            </div>
            <div>
              <p className="text-sm text-gray-700">
                {t('mfa.scan_instructions', 'Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the 6-digit code it shows.')}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 py-2">
            <img src={data.qrDataUrl} alt="MFA QR" className="w-[240px] h-[240px] rounded-xl border border-gray-200" />
            <div className="w-full">
              <div className="text-xs font-semibold text-gray-500 mb-1">
                {t('mfa.manual_key_label', "Can't scan? Enter this key manually:")}
              </div>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <code className="flex-1 text-sm font-mono text-gray-900 break-all">{data.secret}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(data.secret, 'secret')}
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
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="tracking-[0.3em] font-mono text-center text-lg"
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={onConfirm} loading={confirming} disabled={code.length !== 6}>
              {t('mfa.confirm_action', 'Confirm and continue')}
            </Button>
          </div>
        </div>
      ) : step === 'recovery' ? (
        <div className="space-y-5">
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <p className="text-sm text-amber-900 font-semibold mb-1">
              {t('mfa.recovery_save_title', 'Save these recovery codes')}
            </p>
            <p className="text-xs text-amber-800">
              {t('mfa.recovery_save_body', "These are the only way to sign in if you lose your authenticator. They won't be shown again. Each code works once.")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-200 rounded-xl p-4">
            {data.recoveryCodes.map((c, i) => (
              <div key={i} className="font-mono text-sm text-gray-900 tracking-wider">{c}</div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => copyToClipboard(data.recoveryCodes.join('\n'), 'codes')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
            >
              {copiedCodes ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedCodes ? t('mfa.copied', 'Copied') : t('mfa.copy_all_codes', 'Copy all codes')}
            </button>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledgedCodes}
              onChange={(e) => setAcknowledgedCodes(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">
              {t('mfa.recovery_ack', 'I have saved these recovery codes somewhere safe.')}
            </span>
          </label>

          <div className="flex justify-end">
            <Button onClick={onFinish} disabled={!acknowledgedCodes}>
              {t('mfa.finish_action', 'Finish setup')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
