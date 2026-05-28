// Wave 2 tabs for the employee profile: Extended PII, Emergency Contacts,
// Acknowledgements, and the History (actions) timeline. Each tab is
// self-loading — same pattern as DocumentsTab in Wave 1.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { format, parseISO } from 'date-fns';
import {
  Plus, ShieldAlert, Trash2, Phone, Mail, MapPin, CheckCircle2, AlertTriangle,
  Award, Briefcase, MessageSquare, X, FileText,
} from 'lucide-react';
import { adminApi } from '../../../services/api';
import Button from '../../common/Button';
import Card from '../../common/Card';
import Input from '../../common/Input';
import Select from '../../common/Select';
import LoadingSpinner from '../../common/LoadingSpinner';
import EmptyState from '../../common/EmptyState';
import Modal from '../../common/Modal';
import type {
  EmployeeRole, ExtendedProfile, ExtendedProfileResponse,
  EmergencyContact, AcknowledgementStatusItem, EmployeeAction, ActionKind,
} from '../../../types/employeeRecords';
import { REDACTED } from '../../../types/employeeRecords';

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

// ───────────────────────────────────────────────────────────────────────
// Extended PII tab
// ───────────────────────────────────────────────────────────────────────

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

export function ExtendedProfileTab({ role, employeeId }: { role: EmployeeRole; employeeId: string }) {
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
        {hrOfficer && data?.profile && (
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

// ───────────────────────────────────────────────────────────────────────
// Emergency contacts tab
// ───────────────────────────────────────────────────────────────────────

interface ContactFormState {
  fullName: string; relationship: string; phone: string; altPhone: string;
  email: string; address: string; priority: string;
}
const EMPTY_CONTACT: ContactFormState = {
  fullName: '', relationship: '', phone: '', altPhone: '', email: '', address: '', priority: '1',
};

export function EmergencyContactsTab({ role, employeeId }: { role: EmployeeRole; employeeId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EmergencyContact[]>([]);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listEmergencyContacts(role, employeeId);
      setItems(r.data?.contacts ?? []);
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ec.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [role, employeeId]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_CONTACT); setShowForm(true); };
  const openEdit = (c: EmergencyContact) => {
    setEditing(c);
    setForm({
      fullName: c.fullName, relationship: c.relationship ?? '', phone: c.phone ?? '',
      altPhone: c.altPhone ?? '', email: c.email ?? '', address: c.address ?? '',
      priority: String(c.priority),
    });
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        relationship: form.relationship || null,
        phone: form.phone || null,
        altPhone: form.altPhone || null,
        email: form.email || null,
        address: form.address || null,
        priority: Number(form.priority) || 1,
      };
      if (editing) await adminApi.updateEmergencyContact(editing.id, payload);
      else await adminApi.createEmergencyContact(role, employeeId, payload);
      toast.success(t('admin.ec.saved'));
      setShowForm(false);
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ec.failed_save'));
    } finally { setSaving(false); }
  };

  const remove = async (c: EmergencyContact) => {
    if (!confirm(t('admin.ec.confirm_delete', { name: c.fullName }))) return;
    try {
      await adminApi.deleteEmergencyContact(c.id);
      toast.success(t('admin.ec.deleted'));
      await load();
    } catch (e) { toast.error(errMsg(e) || t('admin.ec.failed_delete')); }
  };

  if (loading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t('admin.ec.title')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('admin.ec.subtitle')}</p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>{t('admin.ec.add')}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('admin.ec.empty')} description={t('admin.ec.empty_hint')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(c => (
            <Card key={c.id} className="relative">
              <div className="absolute top-2 right-2 flex gap-1">
                <button onClick={() => openEdit(c)} className="p-1 rounded-md hover:bg-gray-100 text-gray-500"><FileText className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(c)} className="p-1 rounded-md hover:bg-rose-50 text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">#{c.priority}</span>
                <p className="font-semibold text-gray-900">{c.fullName}</p>
              </div>
              {c.relationship && <p className="text-sm text-gray-600">{c.relationship}</p>}
              {c.phone && <p className="text-sm text-gray-700 flex items-center gap-1 mt-1"><Phone className="w-3 h-3 text-gray-400" /> {c.phone}{c.altPhone && ` · ${c.altPhone}`}</p>}
              {c.email && <p className="text-sm text-gray-700 flex items-center gap-1 mt-1"><Mail className="w-3 h-3 text-gray-400" /> {c.email}</p>}
              {c.address && <p className="text-sm text-gray-600 flex items-start gap-1 mt-1"><MapPin className="w-3 h-3 text-gray-400 mt-0.5" /> {c.address}</p>}
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? t('admin.ec.edit') : t('admin.ec.add')} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.full_name')}</label>
              <Input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.relationship')}</label>
              <Input value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.priority')}</label>
              <Input type="number" min={1} max={10} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.phone')}</label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.alt_phone')}</label>
              <Input value={form.altPhone} onChange={e => setForm({ ...form, altPhone: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.email')}</label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.address')}</label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving} disabled={!form.fullName.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Acknowledgements tab
// ───────────────────────────────────────────────────────────────────────

export function AcknowledgementsTab({ role, employeeId }: { role: EmployeeRole; employeeId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AcknowledgementStatusItem[]>([]);
  const [signing, setSigning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listEmployeeAcknowledgements(role, employeeId);
      setItems(r.data?.items ?? []);
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ack.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [role, employeeId]);

  const sign = async (it: AcknowledgementStatusItem) => {
    if (!it.activePolicyId) return;
    setSigning(it.policyKey);
    try {
      await adminApi.createEmployeeAcknowledgement(role, employeeId, { policyId: it.activePolicyId });
      toast.success(t('admin.ack.signed'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.ack.failed_sign'));
    } finally { setSigning(null); }
  };

  if (loading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{t('admin.ack.title')}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{t('admin.ack.subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('admin.ack.empty')} description={t('admin.ack.empty_hint')} />
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_policy')}</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_status')}</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_signed')}</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.policyKey} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900">{it.label}</span>
                      {it.isRequired && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700">{t('admin.ack.required')}</span>}
                      {it.activeVersion && <span className="text-[10px] text-gray-400">v{it.activeVersion}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {it.status === 'signed' && <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" />{t('admin.ack.status_signed')}</span>}
                    {it.status === 'stale'  && <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"><AlertTriangle className="w-3 h-3" />{t('admin.ack.status_stale')}</span>}
                    {it.status === 'unsigned' && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('admin.ack.status_unsigned')}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    {it.ack ? fmtDate(it.ack.acknowledgedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {it.activePolicyId && it.status !== 'signed' && (
                      <Button size="sm" variant="outline" loading={signing === it.policyKey} onClick={() => sign(it)}>
                        {t('admin.ack.sign')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Actions (History) tab
// ───────────────────────────────────────────────────────────────────────

const KIND_ICON: Record<ActionKind, React.ComponentType<{ className?: string }>> = {
  review: MessageSquare, warning: AlertTriangle, commendation: Award,
  role_change: Briefcase, contract_change: FileText, termination: X,
};
const KIND_COLOR: Record<ActionKind, string> = {
  review: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-700',
  commendation: 'bg-emerald-50 text-emerald-700',
  role_change: 'bg-violet-50 text-violet-700',
  contract_change: 'bg-slate-50 text-slate-700',
  termination: 'bg-rose-50 text-rose-700',
};
const CREATABLE_KINDS: ActionKind[] = ['review', 'warning', 'commendation', 'role_change', 'contract_change'];

interface ActionFormState {
  kind: ActionKind;
  occurredOn: string;
  summary: string;
  rating: string;
}

export function ActionsTab({ role, employeeId }: { role: EmployeeRole; employeeId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EmployeeAction[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ActionFormState>({
    kind: 'review', occurredOn: new Date().toISOString().slice(0, 10), summary: '', rating: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listEmployeeActions(role, employeeId);
      setItems(r.data?.actions ?? []);
    } catch (e) {
      toast.error(errMsg(e) || t('admin.act.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [role, employeeId]);

  const submit = async () => {
    setSaving(true);
    try {
      await adminApi.createEmployeeAction(role, employeeId, {
        kind: form.kind, occurredOn: form.occurredOn, summary: form.summary,
        rating: form.kind === 'review' && form.rating ? Number(form.rating) : null,
      });
      toast.success(t('admin.act.recorded'));
      setShowForm(false);
      setForm({ kind: 'review', occurredOn: new Date().toISOString().slice(0, 10), summary: '', rating: '' });
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.act.failed_save'));
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t('admin.act.title')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('admin.act.subtitle')}</p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowForm(true)}>{t('admin.act.add')}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('admin.act.empty')} description={t('admin.act.empty_hint')} />
      ) : (
        <div className="space-y-2">
          {items.map(a => {
            const Icon = KIND_ICON[a.kind];
            return (
              <Card key={a.id}>
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${KIND_COLOR[a.kind]}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm capitalize">{t(`admin.act.kind_${a.kind}`)}</span>
                      <span className="text-xs text-gray-500">{fmtDate(a.occurredOn)}</span>
                      {a.rating != null && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">★ {a.rating}/5</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{a.summary}</p>
                    {a.createdByName && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        {t('admin.act.by')} {a.createdByName}
                        {a.createdByRole && ` (${a.createdByRole})`}
                        {' · '}{fmtDate(a.createdAt)}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={t('admin.act.add')} size="md">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.act.kind')}</label>
            <Select
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value as ActionKind })}
              options={CREATABLE_KINDS.map(k => ({ value: k, label: t(`admin.act.kind_${k}`) }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.act.occurred_on')}</label>
            <Input type="date" value={form.occurredOn} onChange={e => setForm({ ...form, occurredOn: e.target.value })} />
          </div>
          {form.kind === 'review' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.act.rating')}</label>
              <Select
                value={form.rating}
                onChange={e => setForm({ ...form, rating: e.target.value })}
                options={[1,2,3,4,5].map(n => ({ value: String(n), label: `${n}/5` }))}
                placeholder={t('admin.act.rating_optional')}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.act.summary')}</label>
            <textarea
              value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <p className="text-[11px] text-gray-400">{t('admin.act.append_only_note')}</p>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} loading={saving} disabled={!form.summary.trim()}>{t('admin.act.record')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const _unusedExports = useMemo;
void _unusedExports;
