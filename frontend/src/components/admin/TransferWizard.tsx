// Source-side Student Transfer wizard (migration 032 — phase A).
//
// Walks the admin through the four steps of an outgoing transfer:
//   1. Destination — capture the receiving school (non-Scholify only in
//      phase A; the Scholify↔Scholify path lands in phase B with the
//      identity DB).
//   2. Consent — parent signature recorded by the admin, with the
//      canonical text shown for reference.
//   3. Download — generate + download the signed JSON bundle and the
//      companion PDF the parent walks to the destination.
//   4. Complete — archive the student as 'transferred' and finalise.
//
// Each step persists to the backend before moving on so a wizard close
// mid-flow doesn't lose work — re-opening picks up where the row sits.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Send, FileText, Download, CheckCircle2, X as XIcon, AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import LoadingSpinner from '../common/LoadingSpinner';
import { adminApi } from '../../services/api';
import i18n from '../../i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentId: string | null;
  studentName?: string | null;
  onCompleted?: () => void;
}

type Step = 'destination' | 'consent' | 'download' | 'complete';

interface TransferRow {
  id: string;
  status: 'pending_consent' | 'consented' | 'bundle_generated' | 'completed' | 'cancelled';
  studentNameSnapshot: string;
  destinationKind: 'non_scholify' | 'scholify';
  destinationSchoolName: string;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationContact: string | null;
  consentParentName: string | null;
  consentSignedAt: string | null;
  bundleSha256: string | null;
  bundleGeneratedAt: string | null;
}

function statusToStep(status: TransferRow['status']): Step {
  switch (status) {
    case 'pending_consent':  return 'consent';
    case 'consented':        return 'download';
    case 'bundle_generated': return 'complete';
    case 'completed':        return 'complete';
    case 'cancelled':        return 'destination';
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TransferWizard({ isOpen, onClose, studentId, studentName, onCompleted }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('destination');
  const [transfer, setTransfer] = useState<TransferRow | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1 — destination form state
  const [destSchool, setDestSchool] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destCountry, setDestCountry] = useState('');
  const [destContact, setDestContact] = useState('');

  // Step 2 — consent form state
  const [parentName, setParentName] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [witnessRole, setWitnessRole] = useState('');
  const [consentText, setConsentText] = useState<string | null>(null);

  // Reset on open/close.
  useEffect(() => {
    if (!isOpen) {
      setStep('destination'); setTransfer(null);
      setDestSchool(''); setDestCity(''); setDestCountry(''); setDestContact('');
      setParentName(''); setWitnessName(''); setWitnessRole(''); setConsentText(null);
    }
  }, [isOpen]);

  // Whenever a transfer row arrives, advance to the right step + load the
  // consent text if we're heading into the consent step.
  useEffect(() => {
    if (!transfer) return;
    const s = statusToStep(transfer.status);
    setStep(s);
    if (s === 'consent') {
      const load = async () => {
        try {
          const r = await adminApi.getTransferConsent(transfer.id);
          setConsentText((r.data as { text: string }).text);
        } catch {
          setConsentText(null);
        }
      };
      void load();
    }
  }, [transfer]);

  const onStart = async () => {
    if (!studentId) return;
    if (!destSchool.trim()) {
      toast.error(t('admin.transfer.dest_name_required', 'Destination school name is required'));
      return;
    }
    setBusy(true);
    try {
      const r = await adminApi.startTransfer({
        studentId,
        destinationKind: 'non_scholify',
        destinationSchoolName: destSchool.trim(),
        destinationCity: destCity.trim() || undefined,
        destinationCountry: destCountry.trim() || undefined,
        destinationContact: destContact.trim() || undefined,
      });
      setTransfer(r.data as TransferRow);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_start', 'Failed to start transfer'));
    } finally {
      setBusy(false);
    }
  };

  const onCaptureConsent = async () => {
    if (!transfer) return;
    if (!parentName.trim() || !witnessName.trim()) {
      toast.error(t('admin.transfer.consent_fields_required', 'Parent name and witness are required'));
      return;
    }
    setBusy(true);
    try {
      const r = await adminApi.captureTransferConsent(transfer.id, {
        parentName: parentName.trim(),
        witnessName: witnessName.trim(),
        witnessRole: witnessRole.trim() || undefined,
      });
      setTransfer(r.data as TransferRow);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_consent', 'Failed to capture consent'));
    } finally {
      setBusy(false);
    }
  };

  const onDownloadJson = async () => {
    if (!transfer) return;
    setBusy(true);
    try {
      const r = await adminApi.downloadTransferJson(transfer.id);
      downloadBlob(r.data as Blob, `transfer-${transfer.id}.json`);
      // Generation may have advanced status; refresh the row.
      const t2 = await adminApi.getTransfer(transfer.id);
      setTransfer(t2.data as TransferRow);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_download', 'Failed to download bundle'));
    } finally {
      setBusy(false);
    }
  };

  const onDownloadPdf = async () => {
    if (!transfer) return;
    setBusy(true);
    try {
      const r = await adminApi.downloadTransferPdf(transfer.id, i18n.language || 'en');
      downloadBlob(r.data as Blob, `transfer-${transfer.id}.pdf`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_download', 'Failed to download bundle'));
    } finally {
      setBusy(false);
    }
  };

  const onComplete = async () => {
    if (!transfer) return;
    if (!confirm(t('admin.transfer.confirm_complete', 'Archive the student now? This is the final step — the student will be moved to the archive with reason "Transferred".'))) return;
    setBusy(true);
    try {
      await adminApi.completeTransfer(transfer.id);
      toast.success(t('admin.transfer.completed', 'Transfer completed — student archived.'));
      onCompleted?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_complete', 'Failed to complete transfer'));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!transfer) return;
    if (!confirm(t('admin.transfer.confirm_cancel', 'Cancel this transfer? The student stays enrolled — you can start a fresh transfer later.'))) return;
    setBusy(true);
    try {
      await adminApi.cancelTransfer(transfer.id);
      toast.success(t('admin.transfer.cancelled', 'Transfer cancelled.'));
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_cancel', 'Failed to cancel transfer'));
    } finally {
      setBusy(false);
    }
  };

  const title = t('admin.transfer.title', {
    name: studentName || transfer?.studentNameSnapshot || '',
    defaultValue: `Transfer · ${studentName || transfer?.studentNameSnapshot || ''}`,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <Stepper step={step} t={t} />

        {step === 'destination' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm">
              <Send className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
              <span className="text-sky-800">
                {t('admin.transfer.intro_non_scholify',
                  'Phase A handles transfers to non-Scholify schools. You will generate a signed JSON + PDF pack for the parent to walk to the destination. Scholify↔Scholify push lands in a later phase.')}
              </span>
            </div>
            <Input
              label={t('admin.transfer.dest_school', 'Destination school *')}
              placeholder={t('admin.transfer.dest_school_ph', 'e.g. Baghdad International School')}
              value={destSchool} onChange={e => setDestSchool(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('admin.transfer.dest_city', 'City')}
                value={destCity} onChange={e => setDestCity(e.target.value)}
              />
              <Input
                label={t('admin.transfer.dest_country', 'Country')}
                value={destCountry} onChange={e => setDestCountry(e.target.value)}
              />
            </div>
            <Input
              label={t('admin.transfer.dest_contact', 'Contact (email / phone)')}
              value={destContact} onChange={e => setDestContact(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={onStart} loading={busy} disabled={!destSchool.trim()} icon={<Send className="w-4 h-4" />}>
                {t('admin.transfer.next', 'Next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'consent' && transfer && (
          <div className="space-y-3">
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{t('admin.transfer.consent_text', 'Consent text (read to parent)')}</p>
              <p className="text-sm text-gray-800 leading-relaxed">{consentText || <LoadingSpinner />}</p>
            </div>
            <Input
              label={t('admin.transfer.parent_name', 'Parent / guardian full name *')}
              value={parentName} onChange={e => setParentName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('admin.transfer.witness_name', 'Witness (your name) *')}
                value={witnessName} onChange={e => setWitnessName(e.target.value)}
              />
              <Input
                label={t('admin.transfer.witness_role', 'Witness role')}
                placeholder={t('admin.transfer.witness_role_ph', 'e.g. School admin, registrar')}
                value={witnessRole} onChange={e => setWitnessRole(e.target.value)}
              />
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onCancel} disabled={busy} icon={<XIcon className="w-4 h-4" />}>
                {t('admin.transfer.cancel_transfer', 'Cancel transfer')}
              </Button>
              <Button onClick={onCaptureConsent} loading={busy} disabled={!parentName.trim() || !witnessName.trim()}>
                {t('admin.transfer.record_consent', 'Record consent')}
              </Button>
            </div>
          </div>
        )}

        {step === 'download' && transfer && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span className="text-emerald-800">
                {t('admin.transfer.consent_recorded', { name: transfer.consentParentName, defaultValue: `Consent recorded for ${transfer.consentParentName}.` })}
              </span>
            </div>
            <p className="text-sm text-gray-700">
              {t('admin.transfer.download_intro', 'Generate the signed transfer pack. The JSON is the canonical artefact (machine-readable); the PDF is the human-readable companion the parent can carry.')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={onDownloadJson} loading={busy} icon={<Download className="w-4 h-4" />}>
                {t('admin.transfer.download_json', 'Download JSON pack')}
              </Button>
              <Button onClick={onDownloadPdf} loading={busy} icon={<FileText className="w-4 h-4" />} variant="outline">
                {t('admin.transfer.download_pdf', 'Download PDF')}
              </Button>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onCancel} disabled={busy} icon={<XIcon className="w-4 h-4" />}>
                {t('admin.transfer.cancel_transfer', 'Cancel transfer')}
              </Button>
              <Button onClick={() => setStep('complete')} disabled={!transfer.bundleSha256}>
                {t('admin.transfer.next', 'Next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'complete' && transfer && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800">
                {t('admin.transfer.complete_warning', 'The next action archives the student as "Transferred" and removes their live row. Make sure you have already downloaded the JSON + PDF pack and given them to the parent.')}
              </span>
            </div>
            {transfer.bundleSha256 && (
              <div className="text-xs text-gray-500 font-mono break-all">
                SHA-256: {transfer.bundleSha256}
              </div>
            )}
            <div className="flex justify-between gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onCancel} disabled={busy} icon={<XIcon className="w-4 h-4" />}>
                {t('admin.transfer.cancel_transfer', 'Cancel transfer')}
              </Button>
              <Button onClick={onComplete} loading={busy} icon={<CheckCircle2 className="w-4 h-4" />}>
                {t('admin.transfer.archive_and_finish', 'Archive student & finish')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Small step indicator. Kept inline because it's only used by the wizard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Stepper({ step, t }: { step: Step; t: any }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'destination', label: t('admin.transfer.step_destination', 'Destination') },
    { key: 'consent',     label: t('admin.transfer.step_consent', 'Consent') },
    { key: 'download',    label: t('admin.transfer.step_download', 'Download') },
    { key: 'complete',    label: t('admin.transfer.step_complete', 'Complete') },
  ];
  const activeIndex = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
            i < activeIndex ? 'bg-emerald-100 text-emerald-700' :
            i === activeIndex ? 'bg-primary-600 text-white' :
            'bg-gray-100 text-gray-500'
          }`}>{i + 1}</div>
          <span className={`text-xs ${i === activeIndex ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{s.label}</span>
          {i < steps.length - 1 && <div className="w-6 h-px bg-gray-200" />}
        </div>
      ))}
    </div>
  );
}
