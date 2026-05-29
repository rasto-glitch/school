import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Plus, Edit2, Trash2, ShieldCheck, FileText, History as HistoryIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { SchoolPolicy } from '../../types/employeeRecords';

// /admin/school-policies — registry of policies (code of conduct, child
// protection, handbook, etc.) employees can acknowledge. Versioned: a
// body / document URL change bumps to a new version, old version stays
// active until disabled so historical acknowledgements remain anchored
// to the exact text the employee signed.

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

interface PolicyFormState {
  policyKey: string;
  label: string;
  body: string;
  documentUrl: string;
  isRequired: boolean;
  isActive: boolean;
}

const EMPTY_FORM: PolicyFormState = {
  policyKey: '', label: '', body: '', documentUrl: '',
  isRequired: true, isActive: true,
};

export default function SchoolPoliciesPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<SchoolPolicy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SchoolPolicy | null>(null);
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listSchoolPolicies();
      setPolicies(r.data?.policies ?? []);
    } catch (e) {
      toast.error(errMsg(e) || t('admin.policies.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Latest version per key for the top-level list; older versions surface
  // when the row is expanded.
  const { latestByKey, versionsByKey } = useMemo(() => {
    const latest = new Map<string, SchoolPolicy>();
    const versions = new Map<string, SchoolPolicy[]>();
    for (const p of policies) {
      if (!versions.has(p.policyKey)) versions.set(p.policyKey, []);
      versions.get(p.policyKey)!.push(p);
      const cur = latest.get(p.policyKey);
      if (!cur || p.version > cur.version) latest.set(p.policyKey, p);
    }
    return { latestByKey: Array.from(latest.values()), versionsByKey: versions };
  }, [policies]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openBump = (p: SchoolPolicy) => {
    setEditing(p);
    setForm({
      policyKey: p.policyKey, label: p.label,
      body: p.body ?? '', documentUrl: p.documentUrl ?? '',
      isRequired: p.isRequired, isActive: p.isActive,
    });
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.policyKey.trim() || !form.label.trim()) {
      toast.error(t('admin.policies.required_key_label'));
      return;
    }
    setSaving(true);
    try {
      await adminApi.upsertSchoolPolicy({
        policyKey: form.policyKey.trim().toLowerCase(),
        label: form.label.trim(),
        body: form.body || null,
        documentUrl: form.documentUrl || null,
        isRequired: form.isRequired,
        isActive: form.isActive,
      });
      toast.success(editing ? t('admin.policies.bumped') : t('admin.policies.created'));
      setShowForm(false);
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.policies.failed_save'));
    } finally { setSaving(false); }
  };

  const toggleActive = async (p: SchoolPolicy) => {
    try {
      await adminApi.updateSchoolPolicyMeta(p.id, { isActive: !p.isActive });
      toast.success(t('admin.policies.updated'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.policies.failed_save'));
    }
  };

  const toggleRequired = async (p: SchoolPolicy) => {
    try {
      await adminApi.updateSchoolPolicyMeta(p.id, { isRequired: !p.isRequired });
      toast.success(t('admin.policies.updated'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.policies.failed_save'));
    }
  };

  const remove = async (p: SchoolPolicy) => {
    if (!confirm(t('admin.policies.confirm_delete', { label: p.label }))) return;
    try {
      await adminApi.deleteSchoolPolicy(p.id);
      toast.success(t('admin.policies.deleted'));
      await load();
    } catch (e) {
      toast.error(errMsg(e) || t('admin.policies.failed_delete'));
    }
  };

  return (
    <PageLayout title={t('admin.policies.title')} subtitle={t('admin.policies.subtitle')}>
      <div className="space-y-4">
        <Card className="bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-900">{t('admin.policies.banner_title')}</p>
              <p className="text-sm text-blue-800 mt-1">{t('admin.policies.banner_body')}</p>
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>{t('admin.policies.add')}</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : latestByKey.length === 0 ? (
          <EmptyState title={t('admin.policies.empty')} description={t('admin.policies.empty_hint')} />
        ) : (
          <div className="space-y-2">
            {latestByKey.map(p => {
              const versions = versionsByKey.get(p.policyKey) ?? [];
              const isExpanded = expandedKey === p.policyKey;
              return (
                <Card key={p.id}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{p.label}</p>
                        <span className="text-xs text-gray-500">v{p.version}</span>
                        {p.isRequired && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700">
                            {t('admin.policies.required')}
                          </span>
                        )}
                        {!p.isActive && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {t('admin.policies.inactive')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5"><code className="font-mono">{p.policyKey}</code></p>
                      {p.body && (
                        <p className="text-sm text-gray-700 mt-2 line-clamp-2 whitespace-pre-wrap">{p.body}</p>
                      )}
                      {p.documentUrl && (
                        <a href={p.documentUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 mt-1">
                          <FileText className="w-3 h-3" /> {t('admin.policies.view_doc')}
                        </a>
                      )}
                      {versions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setExpandedKey(isExpanded ? null : p.policyKey)}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mt-2"
                        >
                          <HistoryIcon className="w-3 h-3" />
                          {t('admin.policies.versions_count', { count: versions.length })}
                        </button>
                      )}
                      {isExpanded && versions.length > 1 && (
                        <div className="mt-2 border-l-2 border-gray-100 pl-3 space-y-1">
                          {versions.filter(v => v.id !== p.id).map(v => (
                            <div key={v.id} className="text-xs text-gray-500">
                              v{v.version} · {fmtDate(v.createdAt)}{!v.isActive ? ` · ${t('admin.policies.disabled')}` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => openBump(p)} icon={<Edit2 className="w-3.5 h-3.5" />}>
                        {t('admin.policies.bump')}
                      </Button>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => toggleRequired(p)}
                          className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${p.isRequired ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                          title={t('admin.policies.toggle_required')}
                        >
                          {p.isRequired ? t('admin.policies.required') : t('admin.policies.optional')}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(p)}
                          className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${p.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                          title={t('admin.policies.toggle_active')}
                        >
                          {p.isActive ? t('admin.policies.active') : t('admin.policies.inactive')}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p)}
                          className="p-1 rounded-md text-rose-500 hover:bg-rose-50"
                          title={t('admin.policies.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? t('admin.policies.bump_title', { key: editing.policyKey }) : t('admin.policies.add_title')} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.policies.field_key')}</label>
              <Input
                value={form.policyKey}
                onChange={e => setForm({ ...form, policyKey: e.target.value })}
                disabled={!!editing}
                placeholder={t('admin.policies.field_key_ph')}
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('admin.policies.field_key_hint')}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.policies.field_label')}</label>
              <Input
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder={t('admin.policies.field_label_ph')}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.policies.field_doc_url')}</label>
            <Input
              value={form.documentUrl}
              onChange={e => setForm({ ...form, documentUrl: e.target.value })}
              placeholder="https://…"
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('admin.policies.field_doc_url_hint')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.policies.field_body')}</label>
            <textarea
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
              rows={8}
              placeholder={t('admin.policies.field_body_ph')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {editing ? t('admin.policies.field_body_hint_edit') : t('admin.policies.field_body_hint_new')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isRequired} onChange={e => setForm({ ...form, isRequired: e.target.checked })} className="w-4 h-4 text-primary-600" />
              {t('admin.policies.field_required')}
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 text-primary-600" />
              {t('admin.policies.field_active')}
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} loading={saving}>{editing ? t('admin.policies.bump') : t('admin.policies.create')}</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
