import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { Plus, Trash2, Pencil, Users as UsersIcon, ListChecks } from 'lucide-react';
import type { FeePlan, FeeAppliesTo, Class, FeePlanKind } from '../../types';
import { fmtMoney as fmt } from '../../utils/money';

interface InstallmentDraft { sequence: number; amount: number; dueDate: string }

interface PlanForm {
  id?: string;
  name: string;
  totalAmount: string;
  currency: string;
  appliesTo: FeeAppliesTo;
  classIds: string[];
  academicYear: string;
  isActive: boolean;
  installments: InstallmentDraft[];
  kind: FeePlanKind;
  lateFeeEnabled: boolean;
  lateFeeType: 'fixed' | 'percent';
  lateFeeAmount: string;
  lateFeeGraceDays: string;
}

const empty: PlanForm = {
  name: '',
  totalAmount: '',
  currency: 'USD',
  appliesTo: 'all',
  classIds: [],
  academicYear: '',
  isActive: true,
  installments: [{ sequence: 1, amount: 0, dueDate: new Date().toISOString().slice(0, 10) }],
  kind: 'tuition',
  lateFeeEnabled: false,
  lateFeeType: 'fixed',
  lateFeeAmount: '0',
  lateFeeGraceDays: '0',
};

export default function TuitionPlansTab() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<FeePlan[] | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [currentAcademicYear, setCurrentAcademicYear] = useState<string>('');
  const [editing, setEditing] = useState<PlanForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = () => feesApi.listPlans().then(r => setPlans(r.data));
  useEffect(() => {
    load().catch((e: any) => toast.error(e.response?.data?.error || t('accounting.plans.load_failed')));
    feesApi.getSetup().then(r => {
      setClasses(r.data.classes as Class[]);
      setCurrentAcademicYear(r.data.currentAcademicYear ?? '');
    }).catch(() => {});
  }, []);

  // Prefill academic year with the school's current setting (admin sets it in Settings).
  const openNew = () => setEditing({ ...empty, academicYear: currentAcademicYear });
  const openEdit = (p: FeePlan) => setEditing({
    id: p.id,
    name: p.name,
    totalAmount: String(p.totalAmount),
    currency: p.currency,
    appliesTo: p.appliesTo,
    classIds: p.classIds,
    academicYear: p.academicYear ?? '',
    isActive: p.isActive,
    installments: p.installments.length
      ? p.installments.map(i => ({ sequence: i.sequence, amount: i.amount, dueDate: i.dueDate }))
      : [{ sequence: 1, amount: p.totalAmount, dueDate: new Date().toISOString().slice(0, 10) }],
    kind: p.kind ?? 'tuition',
    lateFeeEnabled: !!p.lateFeeEnabled,
    lateFeeType: (p.lateFeeType ?? 'fixed') as 'fixed' | 'percent',
    lateFeeAmount: String(p.lateFeeAmount ?? 0),
    lateFeeGraceDays: String(p.lateFeeGraceDays ?? 0),
  });

  const save = async () => {
    if (!editing) return;
    const total = Number(editing.totalAmount);
    if (!editing.name.trim() || isNaN(total) || total < 0) { toast.error(t('accounting.plans.err_name_total')); return; }
    const sumI = editing.installments.reduce((s, i) => s + Number(i.amount || 0), 0);
    if (Math.abs(sumI - total) > 0.01) { toast.error(t('accounting.plans.err_installments_sum')); return; }
    if (editing.appliesTo === 'classes' && editing.classIds.length === 0) { toast.error(t('accounting.plans.err_select_class')); return; }

    const body = {
      name: editing.name.trim(),
      totalAmount: total,
      currency: editing.currency,
      appliesTo: editing.appliesTo,
      classIds: editing.appliesTo === 'classes' ? editing.classIds : [],
      academicYear: editing.academicYear.trim() || null,
      isActive: editing.isActive,
      installments: editing.installments.map((i, idx) => ({ sequence: idx + 1, amount: Number(i.amount), dueDate: i.dueDate })),
      kind: editing.kind,
      lateFeeEnabled: editing.lateFeeEnabled,
      lateFeeType: editing.lateFeeEnabled ? editing.lateFeeType : null,
      lateFeeAmount: Number(editing.lateFeeAmount) || 0,
      lateFeeGraceDays: Number(editing.lateFeeGraceDays) || 0,
    };

    setSaving(true);
    try {
      if (editing.id) {
        await feesApi.updatePlan(editing.id, body);
        toast.success(t('accounting.plans.updated'));
      } else {
        await feesApi.createPlan(body);
        toast.success(t('accounting.plans.created'));
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.plans.save_failed'));
    } finally { setSaving(false); }
  };

  const remove = async (p: FeePlan) => {
    if (!confirm(t('accounting.plans.delete_confirm', { name: p.name }))) return;
    try {
      await feesApi.deletePlan(p.id);
      toast.success(t('accounting.plans.deleted'));
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.plans.delete_failed'));
    }
  };

  const assign = async (p: FeePlan) => {
    setAssigning(p.id);
    try {
      const r = await feesApi.assignPlan(p.id);
      const { assigned, skipped } = r.data;
      const base = t('accounting.plans.assigned', { count: assigned });
      toast.success(skipped ? `${base} ${t('accounting.plans.assigned_skipped', { count: skipped })}` : base);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.plans.assign_failed'));
    } finally { setAssigning(null); }
  };

  if (plans === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{t('accounting.plans.intro')}</p>
        <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>{t('accounting.plans.new_plan')}</Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState title={t('accounting.plans.none_title')} description={t('accounting.plans.none_desc')} icon={<ListChecks className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-3">
          {plans.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{p.name}</h3>
                    {p.kind && p.kind !== 'tuition' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {t(`accounting.tuition.kind.${p.kind}`)}
                      </span>
                    )}
                    {p.academicYear && <span className="text-xs text-gray-500">· {p.academicYear}</span>}
                    {!p.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('accounting.plans.inactive')}</span>}
                    {p.lateFeeEnabled && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        {t('accounting.plans.late_fee')} {p.lateFeeType === 'percent' ? `${p.lateFeeAmount}%` : fmt(p.lateFeeAmount ?? 0, p.currency)}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {fmt(p.totalAmount, p.currency)} · {p.installments.length} {p.installments.length === 1 ? t('accounting.plans.one_installment') : t('accounting.plans.many_installments')} · {' '}
                    {p.appliesTo === 'all' && t('accounting.plans.applies_all')}
                    {p.appliesTo === 'classes' && t('accounting.plans.applies_classes_count', { count: p.classIds.length })}
                    {p.appliesTo === 'manual' && t('accounting.plans.applies_manual')}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => assign(p)} loading={assigning === p.id} icon={<UsersIcon className="w-4 h-4" />}>{t('accounting.plans.assign')}</Button>
                  <button onClick={() => openEdit(p)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(p)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              {p.installments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {p.installments.map(i => (
                    <div key={i.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                      <div className="text-gray-500">{t('accounting.plans.installment_n', { n: i.sequence })}</div>
                      <div className="font-semibold text-gray-900">{fmt(i.amount, p.currency)}</div>
                      <div className="text-gray-500">{t('accounting.plans.due_date', { date: i.dueDate })}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? t('accounting.plans.edit_title') : t('accounting.plans.new_title')} size="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounting.plans.f_name')} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder={t('accounting.plans.name_ph')} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.plans.f_kind')}</label>
                <select
                  value={editing.kind}
                  onChange={e => setEditing({ ...editing, kind: e.target.value as FeePlanKind })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="tuition">{t('accounting.tuition.kind.tuition')}</option>
                  <option value="transport">{t('accounting.tuition.kind.transport')}</option>
                  <option value="lunch">{t('accounting.tuition.kind.lunch')}</option>
                  <option value="uniform">{t('accounting.tuition.kind.uniform')}</option>
                  <option value="exam">{t('accounting.tuition.kind.exam')}</option>
                  <option value="registration">{t('accounting.tuition.kind.registration')}</option>
                  <option value="other">{t('accounting.tuition.kind.other')}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounting.plans.f_total')} type="number" step="0.01" value={editing.totalAmount} onChange={e => setEditing({ ...editing, totalAmount: e.target.value })} />
              <Input label={t('accounting.plans.f_currency')} value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
            </div>
            <Input
              label={currentAcademicYear ? t('accounting.plans.f_year_autofilled') : t('accounting.plans.f_year_optional')}
              value={editing.academicYear}
              onChange={e => setEditing({ ...editing, academicYear: e.target.value })}
              placeholder={currentAcademicYear || '2026-2027'}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.plans.f_applies_to')}</label>
              <select
                value={editing.appliesTo}
                onChange={e => setEditing({ ...editing, appliesTo: e.target.value as FeeAppliesTo })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">{t('accounting.plans.opt_all')}</option>
                <option value="classes">{t('accounting.plans.opt_classes')}</option>
                <option value="manual">{t('accounting.plans.opt_manual')}</option>
              </select>
            </div>

            {editing.appliesTo === 'classes' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.plans.f_classes')}</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-3">
                  {classes.map(c => {
                    const checked = editing.classIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setEditing({
                            ...editing,
                            classIds: checked ? editing.classIds.filter(id => id !== c.id) : [...editing.classIds, c.id],
                          })}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">{t('accounting.plans.f_installments')}</label>
                <button
                  type="button"
                  onClick={() => setEditing({
                    ...editing,
                    installments: [...editing.installments, { sequence: editing.installments.length + 1, amount: 0, dueDate: new Date().toISOString().slice(0, 10) }],
                  })}
                  className="text-xs text-primary-600 hover:underline"
                >{t('accounting.plans.add_installment')}</button>
              </div>
              <div className="space-y-2">
                {editing.installments.map((i, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="w-24">
                      <Input label={idx === 0 ? t('accounting.plans.f_amount') : ''} type="number" step="0.01" value={i.amount} onChange={e => {
                        const next = [...editing.installments];
                        next[idx] = { ...i, amount: Number(e.target.value) };
                        setEditing({ ...editing, installments: next });
                      }} />
                    </div>
                    <div className="flex-1">
                      <Input label={idx === 0 ? t('accounting.plans.f_due_date') : ''} type="date" value={i.dueDate} onChange={e => {
                        const next = [...editing.installments];
                        next[idx] = { ...i, dueDate: e.target.value };
                        setEditing({ ...editing, installments: next });
                      }} />
                    </div>
                    {editing.installments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setEditing({ ...editing, installments: editing.installments.filter((_, k) => k !== idx) })}
                        className="p-2 text-gray-400 hover:text-red-500 mb-0.5"
                      ><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {t('accounting.plans.sum')}: {fmt(editing.installments.reduce((s, i) => s + Number(i.amount || 0), 0), editing.currency)} · {t('accounting.plans.total')}: {fmt(Number(editing.totalAmount || 0), editing.currency)}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              {t('accounting.plans.active_hint')}
            </label>

            {/* Late fees */}
            <div className="border-t border-gray-100 pt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
                <input type="checkbox" checked={editing.lateFeeEnabled} onChange={e => setEditing({ ...editing, lateFeeEnabled: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
                {t('accounting.plans.late_fee_enable')}
              </label>
              {editing.lateFeeEnabled && (
                <div className="grid grid-cols-3 gap-3 pl-6">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{t('accounting.plans.f_type')}</label>
                    <select value={editing.lateFeeType} onChange={e => setEditing({ ...editing, lateFeeType: e.target.value as 'fixed' | 'percent' })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                      <option value="fixed">{t('accounting.plans.late_fixed')}</option>
                      <option value="percent">{t('accounting.plans.late_percent')}</option>
                    </select>
                  </div>
                  <Input label={editing.lateFeeType === 'percent' ? t('accounting.plans.f_percent') : t('accounting.plans.f_amount')} type="number" step="0.01" value={editing.lateFeeAmount} onChange={e => setEditing({ ...editing, lateFeeAmount: e.target.value })} />
                  <Input label={t('accounting.plans.f_grace_days')} type="number" step="1" value={editing.lateFeeGraceDays} onChange={e => setEditing({ ...editing, lateFeeGraceDays: e.target.value })} />
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2 pl-6">{t('accounting.plans.late_fee_note')}</p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('accounting.plans.cancel')}</Button>
              <Button onClick={save} loading={saving}>{editing.id ? t('accounting.plans.save_changes') : t('accounting.plans.create_plan')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
