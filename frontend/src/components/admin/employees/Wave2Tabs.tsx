// Wave 2 tabs for the employee profile: Extended PII, Emergency Contacts,
// Acknowledgements, and the History (actions) timeline. Each tab is
// self-loading — same pattern as DocumentsTab in Wave 1.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { format, parseISO } from 'date-fns';
import {
  Plus, Trash2, Phone, Mail, MapPin, CheckCircle2, AlertTriangle,
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
import ExtendedProfileForm from './ExtendedProfileForm';
import EmergencyContactFields, {
  EMPTY_CONTACT, type ContactFormState,
} from './EmergencyContactFields';
import type {
  EmployeeRole, EmergencyContact,
  AcknowledgementStatusItem, EmployeeAction, ActionKind,
} from '../../../types/employeeRecords';

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

// ───────────────────────────────────────────────────────────────────────
// Extended PII tab — thin wrapper around the extracted ExtendedProfileForm
// so the wizard and the profile page render identical UI from one source.
// ───────────────────────────────────────────────────────────────────────

export function ExtendedProfileTab({ role, employeeId }: { role: EmployeeRole; employeeId: string }) {
  return <ExtendedProfileForm role={role} employeeId={employeeId} />;
}

// ───────────────────────────────────────────────────────────────────────
// Emergency contacts tab
// ───────────────────────────────────────────────────────────────────────

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
          <EmergencyContactFields value={form} onChange={setForm} />
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
