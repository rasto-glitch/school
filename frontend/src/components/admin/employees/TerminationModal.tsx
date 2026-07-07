import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { AlertTriangle, FileText, Check } from 'lucide-react';
import { adminApi } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import Modal from '../../common/Modal';
import Button from '../../common/Button';
import Input from '../../common/Input';
import type { EmployeeRole } from '../../../types/employeeRecords';

// Termination workflow (Wave 2). Three-step guided flow:
//   1. Final review — show what's about to happen.
//   2. Upload the termination letter (PDF / JPG / PNG) — becomes a
//      'signed_contract'-ish document under the 'other' category until
//      we add a dedicated 'termination_letter' category in Wave 2.5.
//      Note: the backend resolves the category at upload time so any
//      category works; we default to 'other' here.
//   3. Confirm — POST /terminate to record the action, then DELETE the
//      role-specific endpoint to perform the archive.
//
// This is the only path that should ever bundle the document linkage to
// the action and the archive into one user gesture. The plain
// DELETE /admin/teachers/:id endpoint still works for non-termination
// archive reasons (resigned, retired, ...).

interface Props {
  isOpen: boolean;
  onClose: () => void;
  role: EmployeeRole;
  employeeId: string;
  employeeName: string;
  onCompleted: () => void;
}

type Step = 'review' | 'upload' | 'confirm' | 'done';

const ALLOWED_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export default function TerminationModal({ isOpen, onClose, role, employeeId, employeeName, onCompleted }: Props) {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  // Paid `hr` feature: letter upload + terminate-action record. Without it,
  // the modal degrades to the plain archive flow (review → archive) so
  // non-HR schools can still remove employees.
  const hrOn = school?.features?.hr === true;
  const [step, setStep] = useState<Step>('review');
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [departureDate, setDepartureDate] = useState(new Date().toISOString().slice(0, 10));
  const [working, setWorking] = useState(false);

  const reset = () => {
    setStep('review'); setFile(null); setDocumentId(null);
    setSummary(''); setDepartureDate(new Date().toISOString().slice(0, 10));
    setWorking(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const uploadLetter = async () => {
    if (!file) { toast.error(t('admin.term.no_file')); return; }
    setWorking(true);
    try {
      const r = await adminApi.uploadEmployeeDocument(role, employeeId, file, {
        category: 'signed_contract',
        notes: 'Termination letter',
      });
      setDocumentId(r.data?.document?.id ?? null);
      setStep('confirm');
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.term.failed_upload'));
    } finally { setWorking(false); }
  };

  const archiveByRole = async (): Promise<void> => {
    const body = { reason: 'terminated', departureDate };
    switch (role) {
      case 'teacher': await adminApi.deleteTeacher(employeeId, body); return;
      case 'driver':  await adminApi.deleteDriver(employeeId, body); return;
      case 'staff':   await adminApi.archiveStaff(employeeId, body); return;
      case 'supervisor': case 'admin': case 'reception': case 'accountant':
        await adminApi.deleteAccount(employeeId, body); return;
    }
  };

  const finalize = async () => {
    if (hrOn && !documentId) { toast.error(t('admin.term.no_doc')); return; }
    if (hrOn && !summary.trim()) { toast.error(t('admin.term.no_summary')); return; }
    setWorking(true);
    try {
      // Step 1 (hr feature only): record the termination action
      // (employee_actions row + audit).
      if (hrOn && documentId) {
        await adminApi.terminateEmployee(role, employeeId, {
          documentId,
          summary: summary.trim(),
          occurredOn: departureDate,
          departureDate,
        });
      }
      // Step 2: archive via the role-specific DELETE endpoint. Server-side
      // rewriteOwnershipToArchive() repoints all polymorphic rows (docs,
      // extended profile, emergency contacts, acks, actions) at the new
      // archived_employees row, so the data survives the cascade.
      await archiveByRole();
      setStep('done');
      toast.success(t('admin.term.done'));
      onCompleted();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.term.failed_archive'));
    } finally { setWorking(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('admin.term.title', { name: employeeName })} size="md">
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-900">{t('admin.term.warning_title')}</p>
              <p className="text-sm text-rose-700 mt-1">{t('admin.term.warning_body', { name: employeeName })}</p>
            </div>
          </div>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-600 mt-0.5" />
              {t('admin.term.step1_review')}
            </li>
            {hrOn && (
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 mt-0.5" />
                {t('admin.term.step2_upload')}
              </li>
            )}
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-600 mt-0.5" />
              {t('admin.term.step3_archive')}
            </li>
          </ul>
          {!hrOn && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.term.departure_date')}</label>
              <Input type="date" value={departureDate} onChange={e => setDepartureDate(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
            {hrOn ? (
              <Button onClick={() => setStep('upload')}>{t('admin.term.continue')}</Button>
            ) : (
              <Button variant="danger" onClick={finalize} loading={working}>{t('admin.term.finalize')}</Button>
            )}
          </div>
        </div>
      )}

      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('admin.term.upload_hint')}</p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.term.letter')}</label>
            <input
              type="file" accept={ALLOWED_ACCEPT}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setStep('review')}>{t('common.back')}</Button>
            <Button onClick={uploadLetter} loading={working} disabled={!file}>{t('admin.term.upload_btn')}</Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
            <FileText className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800">{t('admin.term.letter_uploaded')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.term.departure_date')}</label>
            <Input type="date" value={departureDate} onChange={e => setDepartureDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.term.summary')}</label>
            <textarea
              value={summary} onChange={e => setSummary(e.target.value)} rows={4}
              placeholder={t('admin.term.summary_ph')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setStep('upload')}>{t('common.back')}</Button>
            <Button variant="danger" onClick={finalize} loading={working} disabled={!summary.trim()}>
              {t('admin.term.finalize')}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4 text-center py-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
            <Check className="w-6 h-6" />
          </div>
          <p className="font-semibold text-gray-900">{t('admin.term.done')}</p>
          <p className="text-sm text-gray-500">{t('admin.term.done_body', { name: employeeName })}</p>
          <Button onClick={handleClose}>{t('common.close')}</Button>
        </div>
      )}
    </Modal>
  );
}
