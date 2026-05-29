// Extracted from Wave2Tabs.ExtendedProfileTab so it can be reused inside
// the Add-employee wizard (NewEmployeeWizard) without duplicating the
// encrypted-field / consent / HR-officer logic.
//
// Behaviour is identical to the original tab: self-loads on (role, employeeId)
// change, renders three Card sections (Personal / Financial / HR-only),
// stamps consent on the first encrypted-field write, and exposes a Redact
// button to HR officers when allowed by the caller.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ShieldAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../../services/api';
import Button from '../../common/Button';
import Card from '../../common/Card';
import Input from '../../common/Input';
import LoadingSpinner from '../../common/LoadingSpinner';
import type {
  EmployeeRole, ExtendedProfile, ExtendedProfileResponse,
} from '../../../types/employeeRecords';
import { REDACTED } from '../../../types/employeeRecords';

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

interface ExtFormState {
  placeOfBirth: string; nationality: string; bloodType: string;
  languagesSpoken: string; dependentsCount: string;
  bankName: string; bankIban: string; taxId: string;
  motherFullName: string; fatherFullName: string; spouseName: string;
  religion: string; socialInsuranceNo: string;
}

const EMPTY_EXT: ExtFormState = {
  placeOfBirth: '', nationality: '', bloodType: '',
  languagesSpoken: '', dependentsCount: '',
  bankName: '', bankIban: '', taxId: '',
  motherFullName: '', fatherFullName: '', spouseName: '',
  religion: '', socialInsuranceNo: '',
};

function shapeForm(p: ExtendedProfile | null): ExtFormState {
  if (!p) return EMPTY_EXT;
  const str = (v: string | null | undefined) => (v == null || v === REDACTED ? '' : v);
  return {
    placeOfBirth: str(p.placeOfBirth),
    nationality: str(p.nationality),
    bloodType: str(p.bloodType),
    languagesSpoken: (p.languagesSpoken ?? []).join(', '),
    dependentsCount: p.dependentsCount == null ? '' : String(p.dependentsCount),
    bankName: str(p.bankName),
    bankIban: str(p.bankIban),
    taxId: str(p.taxId),
    motherFullName: str(p.motherFullName),
    fatherFullName: str(p.fatherFullName),
    spouseName: str(p.spouseName),
    religion: str(p.religion),
    socialInsuranceNo: str(p.socialInsuranceNo),
  };
}

interface Props {
  role: EmployeeRole;
  employeeId: string;
  /** Whether to render the Redact button when the caller is an HR officer.
   * Default: true (profile-page usage). The wizard passes false. */
  allowRedact?: boolean;
  /** Notify parent after a successful save (wizard uses it to flip the
   * section pill to "Saved"). */
  onSaved?: () => void;
}

export default function ExtendedProfileForm({ role, employeeId, allowRedact = true, onSaved }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [data, setData] = useState<ExtendedProfileResponse | null>(null);
  const [form, setForm] = useState<ExtFormState>(EMPTY_EXT);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.getEmployeeExtended(role, employeeId);
      setData(r.data);
      setForm(shapeForm(r.data?.profile ?? null));
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ext.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [role, employeeId]);

  const hrOfficer = !!data?.hrOfficer;
  const isRedacted = !!data?.profile?.redacted;

  const setField = <K extends keyof ExtFormState>(k: K, v: string) => setForm(f => ({ ...f, [k]: v }));

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        placeOfBirth: form.placeOfBirth || null,
        nationality: form.nationality || null,
        bloodType: form.bloodType || null,
        languagesSpoken: form.languagesSpoken
          ? form.languagesSpoken.split(',').map(s => s.trim()).filter(Boolean)
          : null,
        dependentsCount: form.dependentsCount === '' ? null : Number(form.dependentsCount),
        bankName: form.bankName || null,
        bankIban: form.bankIban,
        taxId: form.taxId,
        motherFullName: form.motherFullName,
        fatherFullName: form.fatherFullName,
        spouseName: form.spouseName,
      };
      if (hrOfficer) {
        payload.religion = form.religion;
        payload.socialInsuranceNo = form.socialInsuranceNo;
      }
      // Stamp consent on first save when any encrypted field is set.
      const hasEncrypted = !!(form.motherFullName || form.fatherFullName || form.spouseName
        || form.bankIban || form.taxId || form.religion || form.socialInsuranceNo);
      if (hasEncrypted && !data?.profile?.consentPiiAt) payload.consentPii = true;

      await adminApi.upsertEmployeeExtended(role, employeeId, payload);
      toast.success(t('admin.ext.saved'));
      await load();
      onSaved?.();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ext.failed_save'));
    } finally { setSaving(false); }
  };

  const onRedact = async () => {
    if (!hrOfficer) return;
    const reason = prompt(t('admin.ext.redact_reason_prompt'));
    if (!reason?.trim()) return;
    if (!confirm(t('admin.ext.redact_confirm'))) return;
    setRedacting(true);
    try {
      await adminApi.redactEmployeeExtended(role, employeeId, reason.trim());
      toast.success(t('admin.ext.redacted'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ext.failed_redact'));
    } finally { setRedacting(false); }
  };

  if (loading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>;

  if (isRedacted) {
    return (
      <div className="space-y-3">
        <Card className="bg-rose-50 border-rose-200">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-900">{t('admin.ext.is_redacted_title')}</p>
              <p className="text-sm text-rose-700 mt-1">
                {t('admin.ext.is_redacted_body', { date: fmtDate(data?.profile?.redactedAt) })}
              </p>
              {data?.profile?.redactedReason && (
                <p className="text-xs text-rose-600 mt-2">{t('admin.ext.reason')}: {data.profile.redactedReason}</p>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const PII_NOTE = (
    <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-2">
      <ShieldAlert className="w-3 h-3" /> {t('admin.ext.encrypted_at_rest')}
    </p>
  );

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.ext.section_personal')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.mother_name')}</label>
            <Input value={form.motherFullName} onChange={e => setField('motherFullName', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.father_name')}</label>
            <Input value={form.fatherFullName} onChange={e => setField('fatherFullName', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.spouse_name')}</label>
            <Input value={form.spouseName} onChange={e => setField('spouseName', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.dependents')}</label>
            <Input type="number" value={form.dependentsCount} onChange={e => setField('dependentsCount', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.place_of_birth')}</label>
            <Input value={form.placeOfBirth} onChange={e => setField('placeOfBirth', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.nationality')}</label>
            <Input value={form.nationality} onChange={e => setField('nationality', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.blood_type')}</label>
            <Input value={form.bloodType} onChange={e => setField('bloodType', e.target.value)} placeholder={t('admin.ext.blood_type_ph')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.languages')}</label>
            <Input value={form.languagesSpoken} onChange={e => setField('languagesSpoken', e.target.value)} placeholder={t('admin.ext.languages_ph')} />
          </div>
        </div>
        {PII_NOTE}
      </Card>

      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.ext.section_financial')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.bank_name')}</label>
            <Input value={form.bankName} onChange={e => setField('bankName', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.bank_iban')}</label>
            <Input value={form.bankIban} onChange={e => setField('bankIban', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.tax_id')}</label>
            <Input value={form.taxId} onChange={e => setField('taxId', e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('admin.ext.section_hr_only')}</p>
          {!hrOfficer && (
            <span className="text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-full inline-flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> {t('admin.ext.hr_only_pill')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.religion')}</label>
            <Input
              value={form.religion} onChange={e => setField('religion', e.target.value)}
              disabled={!hrOfficer}
              placeholder={!hrOfficer && data?.profile?.religion === REDACTED ? REDACTED : undefined}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ext.ssn')}</label>
            <Input
              value={form.socialInsuranceNo} onChange={e => setField('socialInsuranceNo', e.target.value)}
              disabled={!hrOfficer}
              placeholder={!hrOfficer && data?.profile?.socialInsuranceNo === REDACTED ? REDACTED : undefined}
            />
          </div>
        </div>
      </Card>

      <div className="flex justify-between items-center pt-2">
        {allowRedact && hrOfficer && data?.profile && (
          <Button variant="ghost" size="sm" onClick={onRedact} loading={redacting}>
            {t('admin.ext.redact_btn')}
          </Button>
        )}
        <div className="ml-auto">
          <Button onClick={onSave} loading={saving}>{t('common.save')}</Button>
        </div>
      </div>
    </div>
  );
}
