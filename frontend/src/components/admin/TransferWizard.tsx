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

type Step = 'destination' | 'consent' | 'download' | 'send' | 'complete';

type TransferStatus =
  | 'pending_consent' | 'consented' | 'bundle_generated'
  | 'awaiting_destination' | 'destination_imported' | 'destination_rejected'
  | 'completed' | 'cancelled';

interface TransferRow {
  id: string;
  status: TransferStatus;
  studentNameSnapshot: string;
  destinationKind: 'non_scholify' | 'scholify';
  destinationSchoolName: string;
  destinationSchoolId: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationContact: string | null;
  destinationRejectedReason: string | null;
  consentParentName: string | null;
  consentSignedAt: string | null;
  bundleSha256: string | null;
  bundleGeneratedAt: string | null;
}

interface DirectoryEntry {
  id: string;
  name: string;
  abbreviation: string | null;
  slug: string;
}

function statusToStep(row: TransferRow): Step {
  // Non-Scholify keeps the 4-step flow it shipped with.
  if (row.destinationKind === 'non_scholify') {
    switch (row.status) {
      case 'pending_consent':  return 'consent';
      case 'consented':        return 'download';
      case 'bundle_generated': return 'complete';
      case 'completed':        return 'complete';
      default:                 return 'destination';
    }
  }
  // Scholify gains a 'send' step between download and complete; complete
  // is gated on destination acceptance.
  switch (row.status) {
    case 'pending_consent':       return 'consent';
    case 'consented':             return 'download';
    case 'bundle_generated':      return 'send';
    case 'awaiting_destination':  return 'send';
    case 'destination_rejected':  return 'send';
    case 'destination_imported':  return 'complete';
    case 'completed':             return 'complete';
    default:                      return 'destination';
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
  const [destKind, setDestKind] = useState<'non_scholify' | 'scholify'>('non_scholify');
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [destSchoolId, setDestSchoolId] = useState<string>('');   // for scholify
  const [destSchool, setDestSchool] = useState('');               // free-text for non_scholify; auto-filled for scholify
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
      setDestKind('non_scholify'); setDirectory([]); setDestSchoolId('');
      setDestSchool(''); setDestCity(''); setDestCountry(''); setDestContact('');
      setParentName(''); setWitnessName(''); setWitnessRole(''); setConsentText(null);
    } else {
      // Eagerly load the Scholify directory so the toggle is responsive.
      adminApi.listTransferDestinations()
        .then(r => setDirectory((r.data || []) as DirectoryEntry[]))
        .catch(() => setDirectory([]));
    }
  }, [isOpen]);

  // Whenever a transfer row arrives, advance to the right step + load the
  // consent text if we're heading into the consent step.
  useEffect(() => {
    if (!transfer) return;
    const s = statusToStep(transfer);
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
    if (destKind === 'scholify') {
      if (!destSchoolId) {
        toast.error(t('admin.transfer.scholify_required', 'Pick a Scholify destination school'));
        return;
      }
    } else {
      if (!destSchool.trim()) {
        toast.error(t('admin.transfer.dest_name_required', 'Destination school name is required'));
        return;
      }
    }
    setBusy(true);
    try {
      const pickedName = destKind === 'scholify'
        ? (directory.find(d => d.id === destSchoolId)?.name || '')
        : destSchool.trim();
      const r = await adminApi.startTransfer({
        studentId,
        destinationKind: destKind,
        destinationSchoolName: pickedName,
        destinationSchoolId: destKind === 'scholify' ? destSchoolId : undefined,
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

  const onSendToDestination = async () => {
    if (!transfer) return;
    setBusy(true);
    try {
      const r = await adminApi.sendTransferToDestination(transfer.id);
      setTransfer(r.data as TransferRow);
      toast.success(t('admin.transfer.sent_to_destination', 'Sent to destination — they will see it in their Incoming inbox.'));
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_send', 'Failed to send to destination'));
    } finally {
      setBusy(false);
    }
  };

  const onRecall = async () => {
    if (!transfer) return;
    if (!confirm(t('admin.transfer.confirm_recall', 'Recall the transfer? Destination will no longer see it; you can re-send or cancel.'))) return;
    setBusy(true);
    try {
      const r = await adminApi.recallTransfer(transfer.id);
      setTransfer(r.data as TransferRow);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('admin.transfer.failed_recall', 'Failed to recall'));
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

  const stepperKind: 'non_scholify' | 'scholify' = transfer?.destinationKind ?? destKind;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <Stepper step={step} kind={stepperKind} t={t} />

        {step === 'destination' && (
          <div className="space-y-3">
            {/* Destination type toggle */}
            <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
              <button
                onClick={() => setDestKind('non_scholify')}
                className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                  destKind === 'non_scholify' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('admin.transfer.kind_non_scholify', 'Non-Scholify school')}
              </button>
              <button
                onClick={() => setDestKind('scholify')}
                className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                  destKind === 'scholify' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('admin.transfer.kind_scholify', 'Another Scholify school')}
              </button>
            </div>

            {destKind === 'non_scholify' ? (
              <>
                <div className="flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm">
                  <Send className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sky-800">
                    {t('admin.transfer.intro_non_scholify',
                      'For non-Scholify destinations you generate a signed JSON + PDF pack the parent walks to the school.')}
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
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 p-3 bg-violet-50 border border-violet-200 rounded-xl text-sm">
                  <Send className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
                  <span className="text-violet-800">
                    {t('admin.transfer.intro_scholify',
                      'For Scholify destinations the bundle goes straight to their Incoming inbox. The destination admin accepts and places the student in a class; you then archive on your end.')}
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('admin.transfer.scholify_school', 'Destination Scholify school *')}
                  </label>
                  {directory.length === 0 ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {t('admin.transfer.no_scholify_destinations', 'No other Scholify schools are available on this platform yet.')}
                    </p>
                  ) : (
                    <select
                      value={destSchoolId}
                      onChange={e => setDestSchoolId(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">{t('admin.transfer.pick_school', '— pick a school —')}</option>
                      {directory.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}{d.abbreviation ? ` (${d.abbreviation})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={onStart} loading={busy}
                disabled={destKind === 'scholify' ? !destSchoolId : !destSchool.trim()}
                icon={<Send className="w-4 h-4" />}
              >
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
              {transfer.destinationKind === 'scholify'
                ? t('admin.transfer.download_intro_scholify', 'Generate the bundle, then send it to the destination Scholify school. They will see it in their Incoming inbox.')
                : t('admin.transfer.download_intro', 'Generate the signed transfer pack. The JSON is the canonical artefact (machine-readable); the PDF is the human-readable companion the parent can carry.')}
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
              <Button
                onClick={() => setStep(transfer.destinationKind === 'scholify' ? 'send' : 'complete')}
                disabled={!transfer.bundleSha256}
              >
                {t('admin.transfer.next', 'Next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'send' && transfer && (
          <div className="space-y-3">
            {transfer.status === 'destination_rejected' && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-red-800">
                  <p className="font-medium">{t('admin.transfer.destination_rejected_title', 'Destination rejected the transfer')}</p>
                  {transfer.destinationRejectedReason && <p className="mt-1">{transfer.destinationRejectedReason}</p>}
                </div>
              </div>
            )}
            {transfer.status === 'awaiting_destination' && (
              <div className="flex items-start gap-2 p-3 bg-violet-50 border border-violet-200 rounded-xl text-sm">
                <Send className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
                <span className="text-violet-800">
                  {t('admin.transfer.awaiting_destination', { name: transfer.destinationSchoolName,
                    defaultValue: `Sent to ${transfer.destinationSchoolName} — waiting for them to accept.` })}
                </span>
              </div>
            )}
            {(transfer.status === 'bundle_generated' || transfer.status === 'destination_rejected') && (
              <p className="text-sm text-gray-700">
                {t('admin.transfer.send_intro', { name: transfer.destinationSchoolName,
                  defaultValue: `Send the bundle to ${transfer.destinationSchoolName}. They will see it in their Incoming inbox; once they accept and import, you can archive on your end.` })}
              </p>
            )}
            <div className="flex justify-between gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={onCancel} disabled={busy} icon={<XIcon className="w-4 h-4" />}>
                {t('admin.transfer.cancel_transfer', 'Cancel transfer')}
              </Button>
              {transfer.status === 'awaiting_destination' ? (
                <Button onClick={onRecall} loading={busy} variant="outline">
                  {t('admin.transfer.recall', 'Recall')}
                </Button>
              ) : (
                <Button onClick={onSendToDestination} loading={busy} icon={<Send className="w-4 h-4" />}>
                  {transfer.status === 'destination_rejected'
                    ? t('admin.transfer.resend', 'Re-send')
                    : t('admin.transfer.send', 'Send to destination')}
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 'complete' && transfer && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800">
                {transfer.destinationKind === 'scholify'
                  ? t('admin.transfer.complete_warning_scholify', { name: transfer.destinationSchoolName,
                      defaultValue: `${transfer.destinationSchoolName} has accepted and the student now exists in their roster. Archiving on your end finalises the transfer.` })
                  : t('admin.transfer.complete_warning', 'The next action archives the student as "Transferred" and removes their live row. Make sure you have already downloaded the JSON + PDF pack and given them to the parent.')}
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
// Scholify destinations add a "Send" step between Download and Complete.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Stepper({ step, kind, t }: { step: Step; kind: 'non_scholify' | 'scholify'; t: any }) {
  const steps: Array<{ key: Step; label: string }> = kind === 'scholify' ? [
    { key: 'destination', label: t('admin.transfer.step_destination', 'Destination') },
    { key: 'consent',     label: t('admin.transfer.step_consent', 'Consent') },
    { key: 'download',    label: t('admin.transfer.step_download', 'Download') },
    { key: 'send',        label: t('admin.transfer.step_send', 'Send') },
    { key: 'complete',    label: t('admin.transfer.step_complete', 'Complete') },
  ] : [
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
