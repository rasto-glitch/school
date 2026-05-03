import { useEffect, useMemo, useState } from 'react';
import { staffApi } from '../../services/api';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { Plus, Trash2, Pencil, Users as UsersIcon, BellRing, Receipt, History } from 'lucide-react';
import type { StaffMember, StaffSalaryPayment, StaffSetupTeacher } from '../../types';

interface StaffForm {
  id?: string;
  userId: string;
  fullName: string;
  position: string;
  salaryAmount: string;
  currency: string;
  nextPaymentDate: string;
  isActive: boolean;
}

const empty: StaffForm = {
  userId: '',
  fullName: '',
  position: '',
  salaryAmount: '',
  currency: 'USD',
  nextPaymentDate: '',
  isActive: true,
};

interface PaymentForm {
  amount: string;
  currency: string;
  paidOn: string;
  periodLabel: string;
  notes: string;
}

function fmtMoney(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function dueBadge(dateStr: string | null): { text: string; cls: string } | null {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d < 0) return { text: `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`, cls: 'bg-red-100 text-red-700' };
  if (d === 0) return { text: 'Due today', cls: 'bg-amber-100 text-amber-800' };
  if (d <= 3) return { text: `Due in ${d} day${d === 1 ? '' : 's'}`, cls: 'bg-amber-100 text-amber-800' };
  if (d <= 7) return { text: `Due in ${d} days`, cls: 'bg-yellow-50 text-yellow-700' };
  return { text: `Due in ${d} days`, cls: 'bg-gray-100 text-gray-600' };
}

export default function StaffSalariesTab() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [teachers, setTeachers] = useState<StaffSetupTeacher[]>([]);
  const [editing, setEditing] = useState<StaffForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<StaffMember | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  const [historyTarget, setHistoryTarget] = useState<StaffMember | null>(null);
  const [history, setHistory] = useState<StaffSalaryPayment[] | null>(null);

  const load = async () => {
    const r = await staffApi.list();
    setStaff(r.data as StaffMember[]);
  };
  const loadSetup = async () => {
    const r = await staffApi.getSetup();
    setTeachers(r.data.teachers as StaffSetupTeacher[]);
  };

  useEffect(() => {
    load().catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load staff'));
    loadSetup().catch(() => {});
  }, []);

  const openNew = () => setEditing({ ...empty });
  const openEdit = (s: StaffMember) => setEditing({
    id: s.id,
    userId: s.userId ?? '',
    fullName: s.fullName,
    position: s.position ?? '',
    salaryAmount: String(s.salaryAmount),
    currency: s.currency,
    nextPaymentDate: s.nextPaymentDate ?? '',
    isActive: s.isActive,
  });

  const save = async () => {
    if (!editing) return;
    const total = Number(editing.salaryAmount);
    if (!editing.fullName.trim() || isNaN(total) || total < 0) { toast.error('Name and salary amount are required'); return; }
    if (!editing.currency.trim()) { toast.error('Currency is required'); return; }

    const body = {
      userId: editing.userId || null,
      fullName: editing.fullName.trim(),
      position: editing.position.trim() || null,
      salaryAmount: total,
      currency: editing.currency.toUpperCase(),
      nextPaymentDate: editing.nextPaymentDate || null,
      isActive: editing.isActive,
    };

    setSaving(true);
    try {
      if (editing.id) {
        await staffApi.update(editing.id, body);
        toast.success('Staff updated');
      } else {
        await staffApi.create(body);
        toast.success('Staff added');
      }
      setEditing(null);
      await Promise.all([load(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const remove = async (s: StaffMember) => {
    if (!confirm(`Remove ${s.fullName}? Payment history will also be deleted. This cannot be undone.`)) return;
    try {
      await staffApi.remove(s.id);
      toast.success('Staff removed');
      await Promise.all([load(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to remove');
    }
  };

  const sendReminder = async (s: StaffMember) => {
    if (!s.userId) { toast.info('No linked account — cannot send notification'); return; }
    setNotifyingId(s.id);
    try {
      await staffApi.notifyDue(s.id);
      toast.success(`Reminder sent to ${s.fullName}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to send reminder');
    } finally { setNotifyingId(null); }
  };

  const openRecordPayment = (s: StaffMember) => {
    setPaymentTarget(s);
    setPaymentForm({
      amount: String(s.salaryAmount),
      currency: s.currency,
      paidOn: new Date().toISOString().slice(0, 10),
      periodLabel: '',
      notes: '',
    });
  };

  const submitPayment = async () => {
    if (!paymentTarget || !paymentForm) return;
    const amt = Number(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) { toast.error('Amount must be greater than 0'); return; }
    if (!paymentForm.paidOn) { toast.error('Payment date is required'); return; }

    setSavingPayment(true);
    try {
      await staffApi.recordPayment(paymentTarget.id, {
        amount: amt,
        currency: paymentForm.currency.toUpperCase(),
        paidOn: paymentForm.paidOn,
        periodLabel: paymentForm.periodLabel.trim() || null,
        notes: paymentForm.notes.trim() || null,
      });
      toast.success('Payment recorded');
      setPaymentTarget(null);
      setPaymentForm(null);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to record payment');
    } finally { setSavingPayment(false); }
  };

  const openHistory = async (s: StaffMember) => {
    setHistoryTarget(s);
    setHistory(null);
    try {
      const r = await staffApi.listPayments(s.id);
      setHistory(r.data as StaffSalaryPayment[]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load payment history');
      setHistoryTarget(null);
    }
  };

  const deletePaymentEntry = async (p: StaffSalaryPayment) => {
    if (!historyTarget) return;
    if (!confirm(`Delete payment of ${fmtMoney(p.amount, p.currency)} from ${p.paidOn}? This cannot be undone.`)) return;
    try {
      await staffApi.deletePayment(p.id);
      toast.success('Payment deleted');
      const r = await staffApi.listPayments(historyTarget.id);
      setHistory(r.data as StaffSalaryPayment[]);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete payment');
    }
  };

  const availableTeachers = useMemo(() => {
    if (!editing) return teachers;
    // When editing, also surface the currently-linked teacher (even though alreadyLinked=true)
    return teachers.filter(t => !t.alreadyLinked || t.userId === editing.userId);
  }, [teachers, editing]);

  if (staff === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Track teacher and staff salaries. Linked teacher accounts receive in-app notifications when reminders are sent.</p>
        <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>Add staff</Button>
      </div>

      {staff.length === 0 ? (
        <EmptyState title="No staff yet" description="Add a teacher or custom employee to start tracking salaries." icon={<UsersIcon className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-3">
          {staff.map(s => {
            const badge = s.isActive ? dueBadge(s.nextPaymentDate) : null;
            return (
              <div key={s.id} className={`bg-white rounded-2xl border border-gray-200 p-4 ${!s.isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{s.fullName}</h3>
                      {s.position && <span className="text-xs text-gray-500">· {s.position}</span>}
                      {!s.isActive && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Inactive</span>}
                      {!s.userId && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">No account</span>}
                      {badge && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      Salary: <span className="font-semibold text-gray-700">{fmtMoney(s.salaryAmount, s.currency)}</span>
                      {s.nextPaymentDate && <> · Next payment: {s.nextPaymentDate}</>}
                      {s.lastPayment && <> · Last paid: {fmtMoney(s.lastPayment.amount, s.lastPayment.currency)} on {s.lastPayment.paidOn}</>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => openRecordPayment(s)} icon={<Receipt className="w-4 h-4" />}>Record payment</Button>
                    <Button size="sm" variant="ghost" onClick={() => openHistory(s)} icon={<History className="w-4 h-4" />}>History</Button>
                    {s.userId && s.isActive && (
                      <Button size="sm" variant="ghost" onClick={() => sendReminder(s)} loading={notifyingId === s.id} icon={<BellRing className="w-4 h-4" />}>Send reminder</Button>
                    )}
                    <button onClick={() => openEdit(s)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(s)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? 'Edit staff' : 'Add staff'} size="lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Linked teacher account (optional)</label>
              <select
                value={editing.userId}
                onChange={e => {
                  const userId = e.target.value;
                  const t = teachers.find(x => x.userId === userId);
                  setEditing({ ...editing, userId, fullName: t ? t.fullName : editing.fullName, position: t?.subject ? `Teacher · ${t.subject}` : editing.position });
                }}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— Custom employee (no account) —</option>
                {availableTeachers.map(t => (
                  <option key={t.userId} value={t.userId}>
                    {t.fullName}{t.subject ? ` (${t.subject})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Linked teachers receive a push notification when you send a reminder.</p>
            </div>

            <Input label="Full name" value={editing.fullName} onChange={e => setEditing({ ...editing, fullName: e.target.value })} placeholder="e.g. Sarah Ahmed" />
            <Input label="Position (optional)" value={editing.position} onChange={e => setEditing({ ...editing, position: e.target.value })} placeholder="e.g. Janitor, Bus Driver, Math Teacher" />

            <div className="grid grid-cols-2 gap-3">
              <Input label="Salary amount" type="number" step="0.01" value={editing.salaryAmount} onChange={e => setEditing({ ...editing, salaryAmount: e.target.value })} />
              <Input label="Currency" value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
            </div>

            <Input label="Next payment date (optional)" type="date" value={editing.nextPaymentDate} onChange={e => setEditing({ ...editing, nextPaymentDate: e.target.value })} />

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              Active (uncheck to archive without deleting)
            </label>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} loading={saving}>{editing.id ? 'Save changes' : 'Add staff'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {paymentTarget && paymentForm && (
        <Modal isOpen onClose={() => { setPaymentTarget(null); setPaymentForm(null); }} title={`Record payment — ${paymentTarget.fullName}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount" type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
              <Input label="Currency" value={paymentForm.currency} onChange={e => setPaymentForm({ ...paymentForm, currency: e.target.value.toUpperCase() })} />
            </div>
            <Input label="Payment date" type="date" value={paymentForm.paidOn} onChange={e => setPaymentForm({ ...paymentForm, paidOn: e.target.value })} />
            <Input label="Period label (optional)" value={paymentForm.periodLabel} onChange={e => setPaymentForm({ ...paymentForm, periodLabel: e.target.value })} placeholder="e.g. May 2026" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea
                value={paymentForm.notes}
                onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            {paymentTarget.userId && (
              <p className="text-xs text-gray-500">A confirmation notification will be sent to {paymentTarget.fullName}.</p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => { setPaymentTarget(null); setPaymentForm(null); }}>Cancel</Button>
              <Button onClick={submitPayment} loading={savingPayment}>Record payment</Button>
            </div>
          </div>
        </Modal>
      )}

      {historyTarget && (
        <Modal isOpen onClose={() => { setHistoryTarget(null); setHistory(null); }} title={`Payment history — ${historyTarget.fullName}`} size="xl">
          {history === null ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No payments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map(p => (
                <div key={p.id} className="flex items-start justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">{fmtMoney(p.amount, p.currency)}</div>
                    <div className="text-xs text-gray-500">
                      Paid on {p.paidOn}
                      {p.periodLabel && <> · {p.periodLabel}</>}
                    </div>
                    {p.notes && <div className="text-xs text-gray-600 mt-1">{p.notes}</div>}
                  </div>
                  <button onClick={() => deletePaymentEntry(p)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
