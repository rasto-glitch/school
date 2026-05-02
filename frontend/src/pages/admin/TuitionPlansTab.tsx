import { useEffect, useState } from 'react';
import { feesApi, adminApi } from '../../services/api';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { Plus, Trash2, Pencil, Users as UsersIcon, ListChecks } from 'lucide-react';
import type { FeePlan, FeeAppliesTo, Class } from '../../types';

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
};

function fmt(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

export default function TuitionPlansTab() {
  const [plans, setPlans] = useState<FeePlan[] | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [editing, setEditing] = useState<PlanForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = () => feesApi.listPlans().then(r => setPlans(r.data));
  useEffect(() => {
    load().catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load plans'));
    adminApi.getClasses().then(r => setClasses(r.data || []));
  }, []);

  const openNew = () => setEditing({ ...empty });
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
  });

  const save = async () => {
    if (!editing) return;
    const total = Number(editing.totalAmount);
    if (!editing.name.trim() || isNaN(total) || total < 0) { toast.error('Name and total are required'); return; }
    const sumI = editing.installments.reduce((s, i) => s + Number(i.amount || 0), 0);
    if (Math.abs(sumI - total) > 0.01) { toast.error('Installments must sum to the total'); return; }
    if (editing.appliesTo === 'classes' && editing.classIds.length === 0) { toast.error('Select at least one class'); return; }

    const body = {
      name: editing.name.trim(),
      totalAmount: total,
      currency: editing.currency,
      appliesTo: editing.appliesTo,
      classIds: editing.appliesTo === 'classes' ? editing.classIds : [],
      academicYear: editing.academicYear.trim() || null,
      isActive: editing.isActive,
      installments: editing.installments.map((i, idx) => ({ sequence: idx + 1, amount: Number(i.amount), dueDate: i.dueDate })),
    };

    setSaving(true);
    try {
      if (editing.id) {
        await feesApi.updatePlan(editing.id, body);
        toast.success('Plan updated');
      } else {
        await feesApi.createPlan(body);
        toast.success('Plan created');
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save plan');
    } finally { setSaving(false); }
  };

  const remove = async (p: FeePlan) => {
    if (!confirm(`Delete plan "${p.name}"? This cannot be undone.`)) return;
    try {
      await feesApi.deletePlan(p.id);
      toast.success('Plan deleted');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    }
  };

  const assign = async (p: FeePlan) => {
    setAssigning(p.id);
    try {
      const r = await feesApi.assignPlan(p.id);
      const { assigned, skipped } = r.data;
      toast.success(`Assigned to ${assigned} student${assigned === 1 ? '' : 's'}${skipped ? ` (${skipped} already had it)` : ''}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to assign');
    } finally { setAssigning(null); }
  };

  if (plans === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Fee plans define tuition amounts and installment due dates. Assign a plan to students to start tracking.</p>
        <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>New plan</Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState title="No plans yet" description="Create your first tuition plan." icon={<ListChecks className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-3">
          {plans.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{p.name}</h3>
                    {p.academicYear && <span className="text-xs text-gray-500">· {p.academicYear}</span>}
                    {!p.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Inactive</span>}
                  </div>
                  <div className="text-sm text-gray-500">
                    {fmt(p.totalAmount, p.currency)} · {p.installments.length} installment{p.installments.length === 1 ? '' : 's'} · {' '}
                    {p.appliesTo === 'all' && 'all students'}
                    {p.appliesTo === 'classes' && `${p.classIds.length} class${p.classIds.length === 1 ? '' : 'es'}`}
                    {p.appliesTo === 'manual' && 'manual assignment'}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => assign(p)} loading={assigning === p.id} icon={<UsersIcon className="w-4 h-4" />}>Assign</Button>
                  <button onClick={() => openEdit(p)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(p)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              {p.installments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {p.installments.map(i => (
                    <div key={i.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                      <div className="text-gray-500">Installment {i.sequence}</div>
                      <div className="font-semibold text-gray-900">{fmt(i.amount, p.currency)}</div>
                      <div className="text-gray-500">due {i.dueDate}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? 'Edit plan' : 'New plan'} size="xl">
          <div className="space-y-4">
            <Input label="Name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="2026-2027 Tuition" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Total amount" type="number" step="0.01" value={editing.totalAmount} onChange={e => setEditing({ ...editing, totalAmount: e.target.value })} />
              <Input label="Currency" value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
            </div>
            <Input label="Academic year (optional)" value={editing.academicYear} onChange={e => setEditing({ ...editing, academicYear: e.target.value })} placeholder="2026-2027" />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Applies to</label>
              <select
                value={editing.appliesTo}
                onChange={e => setEditing({ ...editing, appliesTo: e.target.value as FeeAppliesTo })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All students</option>
                <option value="classes">Specific class(es)</option>
                <option value="manual">Manual (assign one by one)</option>
              </select>
            </div>

            {editing.appliesTo === 'classes' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Classes</label>
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
                <label className="block text-sm font-medium text-gray-700">Installments</label>
                <button
                  type="button"
                  onClick={() => setEditing({
                    ...editing,
                    installments: [...editing.installments, { sequence: editing.installments.length + 1, amount: 0, dueDate: new Date().toISOString().slice(0, 10) }],
                  })}
                  className="text-xs text-primary-600 hover:underline"
                >+ Add installment</button>
              </div>
              <div className="space-y-2">
                {editing.installments.map((i, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="w-24">
                      <Input label={idx === 0 ? 'Amount' : ''} type="number" step="0.01" value={i.amount} onChange={e => {
                        const next = [...editing.installments];
                        next[idx] = { ...i, amount: Number(e.target.value) };
                        setEditing({ ...editing, installments: next });
                      }} />
                    </div>
                    <div className="flex-1">
                      <Input label={idx === 0 ? 'Due date' : ''} type="date" value={i.dueDate} onChange={e => {
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
                Sum: {fmt(editing.installments.reduce((s, i) => s + Number(i.amount || 0), 0), editing.currency)} · Total: {fmt(Number(editing.totalAmount || 0), editing.currency)}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              Active (uncheck to archive without deleting)
            </label>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>{editing.id ? 'Save changes' : 'Create plan'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
