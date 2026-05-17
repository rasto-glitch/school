import { useEffect, useMemo, useState } from 'react';
import { staffApi, accountingApi, type PaymentAccount } from '../../services/api';
import { fmtMoney } from '../../utils/money';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../components/common/ReturningEmployeeSearch';
import { Plus, Trash2, Pencil, Users as UsersIcon, BellRing, Receipt, History, Megaphone, Archive as ArchiveIcon, RotateCcw, FileDown, FileSpreadsheet, Shield, ShieldCheck, CalendarClock } from 'lucide-react';
import type { StaffMember, StaffSalaryPayment, StaffSetupTeacher, StaffSetupSupervisor } from '../../types';

type SubTab = 'active' | 'archive' | 'voided';

interface VoidedStaffRow {
  id: string;
  fullName: string;
  position: string | null;
  salaryAmount: number;
  currency: string;
  voidedAt: string;
  voidReason: string | null;
  voidedByName: string | null;
}

interface VoidedStaffPaymentRow {
  id: string;
  amount: number;
  currency: string;
  paidOn: string;
  periodLabel: string | null;
  notes: string | null;
  insuranceAmount: number;
  voidedAt: string;
  voidReason: string | null;
  voidedByName: string | null;
  staffId: string;
  staffName: string | null;
}

interface StaffForm {
  id?: string;
  userId: string;
  fullName: string;
  position: string;
  salaryAmount: string;
  currency: string;
  nextPaymentDate: string;
  isActive: boolean;
  insurancePercentage: string;
  previousArchiveId?: string | null;
}

const empty: StaffForm = {
  userId: '',
  fullName: '',
  position: '',
  salaryAmount: '',
  currency: 'USD',
  nextPaymentDate: '',
  isActive: true,
  insurancePercentage: '',
  previousArchiveId: null,
};

interface PaymentForm {
  amount: string;
  currency: string;
  paidOn: string;
  periodLabel: string;
  notes: string;
  insurancePercentage: string;
  insuranceAmount: string;
  insuranceTouched: boolean;
  taxAmount: string;
  taxLabel: string;
  paymentAccountId: string;
}

interface InsurancePayoutForm {
  paidOn: string;
  amount: string;
  currency: string;
  notes: string;
}

interface BulkNextPaymentForm {
  date: string;
  selectedIds: Set<string>;
}

interface MassReminderForm {
  title: string;
  message: string;
  onlyDueSoon: boolean;
  dueWithinDays: string;
}

const emptyMass: MassReminderForm = {
  title: '',
  message: '',
  onlyDueSoon: false,
  dueWithinDays: '7',
};


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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function StaffSalariesTab() {
  const [subTab, setSubTab] = useState<SubTab>('active');
  const [active, setActive] = useState<StaffMember[] | null>(null);
  const [archived, setArchived] = useState<StaffMember[] | null>(null);
  const [voidedStaff, setVoidedStaff] = useState<VoidedStaffRow[] | null>(null);
  const [voidedPayments, setVoidedPayments] = useState<VoidedStaffPaymentRow[] | null>(null);
  const [unvoidBusy, setUnvoidBusy] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<StaffSetupTeacher[]>([]);
  const [supervisors, setSupervisors] = useState<StaffSetupSupervisor[]>([]);
  const [editing, setEditing] = useState<StaffForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [staffPrevLabel, setStaffPrevLabel] = useState('');
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const [paymentTarget, setPaymentTarget] = useState<StaffMember | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  // Active payment accounts (cash drawers / bank tills) for the salary modal's "paid from" picker.
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  const [historyTarget, setHistoryTarget] = useState<StaffMember | null>(null);
  const [history, setHistory] = useState<StaffSalaryPayment[] | null>(null);

  const [massReminder, setMassReminder] = useState<MassReminderForm | null>(null);
  const [sendingMass, setSendingMass] = useState(false);

  const [insurancePayoutTarget, setInsurancePayoutTarget] = useState<StaffMember | null>(null);
  const [insurancePayoutForm, setInsurancePayoutForm] = useState<InsurancePayoutForm | null>(null);
  const [savingInsurancePayout, setSavingInsurancePayout] = useState(false);
  const [reversingInsuranceId, setReversingInsuranceId] = useState<string | null>(null);

  const [bulkNextPayment, setBulkNextPayment] = useState<BulkNextPaymentForm | null>(null);
  const [savingBulkNext, setSavingBulkNext] = useState(false);

  const loadActive = async () => {
    const r = await staffApi.list('active');
    setActive(r.data as StaffMember[]);
  };
  const loadArchive = async () => {
    const r = await staffApi.list('archived');
    setArchived(r.data as StaffMember[]);
  };
  const loadSetup = async () => {
    const r = await staffApi.getSetup();
    setTeachers(r.data.teachers as StaffSetupTeacher[]);
    setSupervisors((r.data.supervisors ?? []) as StaffSetupSupervisor[]);
  };
  const loadAll = () => Promise.all([loadActive(), loadArchive()]);
  const loadVoided = async () => {
    const [s, p] = await Promise.all([staffApi.listVoided(), staffApi.listVoidedPayments()]);
    setVoidedStaff(s.data as VoidedStaffRow[]);
    setVoidedPayments(p.data as VoidedStaffPaymentRow[]);
  };

  useEffect(() => {
    loadAll().catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load staff'));
    loadSetup().catch(() => {});
    // Only show active accounts in the payment "paid from" picker so retired tills don't clutter it.
    accountingApi.listPaymentAccounts().then(r => setAccounts(r.data.filter(a => a.isActive))).catch(() => {});
  }, []);

  useEffect(() => {
    if (subTab === 'voided' && (voidedStaff === null || voidedPayments === null)) {
      loadVoided().catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load voided records'));
    }
  }, [subTab]);

  const unvoidStaff = async (id: string) => {
    if (!confirm('Restore this voided staff member?')) return;
    setUnvoidBusy(id);
    try {
      await staffApi.unvoid(id);
      toast.success('Staff member restored');
      await Promise.all([loadVoided(), loadAll()]);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to restore'); }
    finally { setUnvoidBusy(null); }
  };

  const unvoidStaffPayment = async (id: string) => {
    if (!confirm("Restore this voided payment? It will reappear in the staff member's payment history.")) return;
    setUnvoidBusy(id);
    try {
      await staffApi.unvoidPayment(id);
      toast.success('Payment restored');
      await loadVoided();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to restore'); }
    finally { setUnvoidBusy(null); }
  };

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
    insurancePercentage: s.insurancePercentage !== null && s.insurancePercentage !== undefined ? String(s.insurancePercentage) : '',
  });

  const save = async () => {
    if (!editing) return;
    const total = Number(editing.salaryAmount);
    if (!editing.fullName.trim() || isNaN(total) || total < 0) { toast.error('Name and salary amount are required'); return; }
    if (!editing.currency.trim()) { toast.error('Currency is required'); return; }

    let insurancePct: number | null = null;
    if (editing.insurancePercentage.trim() !== '') {
      const pct = Number(editing.insurancePercentage);
      if (isNaN(pct) || pct < 0 || pct > 100) { toast.error('Insurance % must be between 0 and 100'); return; }
      insurancePct = pct;
    }

    const body = {
      userId: editing.userId || null,
      fullName: editing.fullName.trim(),
      position: editing.position.trim() || null,
      salaryAmount: total,
      currency: editing.currency.toUpperCase(),
      nextPaymentDate: editing.nextPaymentDate || null,
      isActive: editing.isActive,
      insurancePercentage: insurancePct,
    };

    setSaving(true);
    try {
      if (editing.id) {
        await staffApi.update(editing.id, body);
        toast.success('Staff updated');
      } else {
        await staffApi.create({ ...body, previousArchiveId: editing.previousArchiveId || undefined });
        toast.success('Staff added');
      }
      setEditing(null);
      setStaffPrevLabel('');
      await Promise.all([loadAll(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const deactivate = async (s: StaffMember) => {
    if (!confirm(`Deactivate ${s.fullName}? Their record will move to the archive but payment history will be kept.`)) return;
    try {
      await staffApi.update(s.id, { isActive: false });
      toast.success('Staff archived');
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to deactivate');
    }
  };

  const reactivate = async (s: StaffMember) => {
    if (s.userIsActive === false) {
      toast.error('Reactivate the user account in the admin portal first.');
      return;
    }
    setReactivatingId(s.id);
    try {
      await staffApi.update(s.id, { isActive: true });
      toast.success('Staff reactivated');
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reactivate');
    } finally { setReactivatingId(null); }
  };

  const remove = async (s: StaffMember) => {
    if (!confirm(`Permanently delete ${s.fullName}? Payment history will also be deleted. This cannot be undone.`)) return;
    try {
      await staffApi.remove(s.id);
      toast.success('Staff deleted');
      await Promise.all([loadAll(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete');
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
    const pct = s.insurancePercentage ?? 0;
    const insAmt = pct > 0 ? Math.round((s.salaryAmount * pct) / 100 * 100) / 100 : 0;
    setPaymentForm({
      amount: String(s.salaryAmount),
      currency: s.currency,
      paidOn: new Date().toISOString().slice(0, 10),
      periodLabel: '',
      notes: '',
      insurancePercentage: s.insurancePercentage !== null && s.insurancePercentage !== undefined ? String(s.insurancePercentage) : '',
      insuranceAmount: insAmt > 0 ? String(insAmt) : '',
      insuranceTouched: false,
      taxAmount: '',
      taxLabel: '',
      paymentAccountId: '',
    });
  };

  const submitPayment = async () => {
    if (!paymentTarget || !paymentForm) return;
    const amt = Number(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) { toast.error('Amount must be greater than 0'); return; }
    if (!paymentForm.paidOn) { toast.error('Payment date is required'); return; }

    let insAmt: number | null = null;
    if (paymentForm.insuranceAmount.trim() !== '') {
      const v = Number(paymentForm.insuranceAmount);
      if (isNaN(v) || v < 0) { toast.error('Insurance amount must be non-negative'); return; }
      if (v > amt) { toast.error('Insurance cannot exceed the payment amount'); return; }
      insAmt = Math.round(v * 100) / 100;
    }
    let insPct: number | null = null;
    if (paymentForm.insurancePercentage.trim() !== '') {
      const v = Number(paymentForm.insurancePercentage);
      if (isNaN(v) || v < 0 || v > 100) { toast.error('Insurance % must be between 0 and 100'); return; }
      insPct = v;
    }

    setSavingPayment(true);
    try {
      await staffApi.recordPayment(paymentTarget.id, {
        amount: amt,
        currency: paymentForm.currency.toUpperCase(),
        paidOn: paymentForm.paidOn,
        periodLabel: paymentForm.periodLabel.trim() || null,
        notes: paymentForm.notes.trim() || null,
        insuranceAmount: insAmt,
        insurancePercentage: insPct,
        taxAmount: Number(paymentForm.taxAmount) || 0,
        taxLabel: paymentForm.taxLabel.trim() || null,
        paymentAccountId: paymentForm.paymentAccountId || null,
      });
      toast.success('Payment recorded');
      setPaymentTarget(null);
      setPaymentForm(null);
      await loadAll();
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
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete payment');
    }
  };

  const openInsurancePayout = (s: StaffMember) => {
    setInsurancePayoutTarget(s);
    setInsurancePayoutForm({
      paidOn: new Date().toISOString().slice(0, 10),
      amount: String(s.insuranceHeldTotal || 0),
      currency: s.currency,
      notes: '',
    });
  };

  const submitInsurancePayout = async () => {
    if (!insurancePayoutTarget || !insurancePayoutForm) return;
    const amt = Number(insurancePayoutForm.amount);
    if (isNaN(amt) || amt < 0) { toast.error('Amount must be non-negative'); return; }
    if (!insurancePayoutForm.paidOn) { toast.error('Date is required'); return; }

    setSavingInsurancePayout(true);
    try {
      await staffApi.payInsurance(insurancePayoutTarget.id, {
        paidOn: insurancePayoutForm.paidOn,
        amount: amt,
        currency: insurancePayoutForm.currency.toUpperCase(),
        notes: insurancePayoutForm.notes.trim() || null,
      });
      toast.success('Insurance marked as paid');
      setInsurancePayoutTarget(null);
      setInsurancePayoutForm(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to mark insurance paid');
    } finally { setSavingInsurancePayout(false); }
  };

  const reverseInsurancePayout = async (s: StaffMember) => {
    if (!confirm(`Reverse the insurance payout for ${s.fullName}? Their insurance will be marked as still pending.`)) return;
    setReversingInsuranceId(s.id);
    try {
      await staffApi.reverseInsurancePayout(s.id);
      toast.success('Insurance payout reversed');
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reverse payout');
    } finally { setReversingInsuranceId(null); }
  };

  const openBulkNextPayment = () => {
    if (!active) return;
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const defaultDate = d.toISOString().slice(0, 10);
    setBulkNextPayment({
      date: defaultDate,
      selectedIds: new Set(active.map(s => s.id)),
    });
  };

  const submitBulkNextPayment = async () => {
    if (!bulkNextPayment) return;
    if (bulkNextPayment.selectedIds.size === 0) { toast.error('Select at least one staff member'); return; }
    if (bulkNextPayment.date && !/^\d{4}-\d{2}-\d{2}$/.test(bulkNextPayment.date)) {
      toast.error('Enter a valid date'); return;
    }
    setSavingBulkNext(true);
    try {
      const r = await staffApi.bulkSetNextPayment({
        nextPaymentDate: bulkNextPayment.date || null,
        staffIds: Array.from(bulkNextPayment.selectedIds),
      });
      const n = r.data?.updated ?? bulkNextPayment.selectedIds.size;
      toast.success(
        bulkNextPayment.date
          ? `Next payment date set for ${n} staff member${n === 1 ? '' : 's'}`
          : `Next payment date cleared for ${n} staff member${n === 1 ? '' : 's'}`
      );
      setBulkNextPayment(null);
      await loadActive();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update');
    } finally { setSavingBulkNext(false); }
  };

  const sendMassReminder = async () => {
    if (!massReminder) return;
    const days = Number(massReminder.dueWithinDays);
    const body: { title?: string; message?: string; dueWithinDays?: number } = {};
    if (massReminder.title.trim()) body.title = massReminder.title.trim();
    if (massReminder.message.trim()) body.message = massReminder.message.trim();
    if (massReminder.onlyDueSoon && !isNaN(days) && days >= 0) body.dueWithinDays = Math.floor(days);

    setSendingMass(true);
    try {
      const r = await staffApi.notifyAllDue(body);
      const count = r.data?.sent ?? 0;
      toast.success(count === 0 ? 'No staff matched the filter' : `Reminder sent to ${count} staff member${count === 1 ? '' : 's'}`);
      setMassReminder(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to send reminders');
    } finally { setSendingMass(false); }
  };

  const exportPdf = async (s: StaffMember) => {
    setExporting(`${s.id}:pdf`);
    try {
      const r = await staffApi.downloadSalaryPdf(s.id);
      downloadBlob(r.data as Blob, `salary-${s.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to download PDF');
    } finally { setExporting(null); }
  };

  const exportXlsx = async (s: StaffMember) => {
    setExporting(`${s.id}:xlsx`);
    try {
      const r = await staffApi.downloadSalaryXlsx(s.id);
      downloadBlob(r.data as Blob, `salary-${s.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.xlsx`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to download Excel');
    } finally { setExporting(null); }
  };

  const availableTeachers = useMemo(() => {
    if (!editing) return teachers;
    return teachers.filter(t => !t.alreadyLinked || t.userId === editing.userId);
  }, [teachers, editing]);

  const availableSupervisors = useMemo(() => {
    if (!editing) return supervisors;
    return supervisors.filter(s => !s.alreadyLinked || s.userId === editing.userId);
  }, [supervisors, editing]);

  const list = subTab === 'active' ? active : archived;

  return (
    <div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
        <button
          onClick={() => setSubTab('active')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >Active{active && ` (${active.length})`}</button>
        <button
          onClick={() => setSubTab('archive')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'archive' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >Archive{archived && ` (${archived.length})`}</button>
        <button
          onClick={() => setSubTab('voided')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'voided' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >Voided{voidedStaff && voidedPayments && ` (${voidedStaff.length + voidedPayments.length})`}</button>
      </div>

      {subTab === 'active' && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">Track teacher and staff salaries. Linked teachers receive in-app notifications when reminders are sent.</p>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" onClick={openBulkNextPayment} icon={<CalendarClock className="w-4 h-4" />}>Set next payment</Button>
            <Button variant="ghost" onClick={() => setMassReminder({ ...emptyMass })} icon={<Megaphone className="w-4 h-4" />}>Mass reminder</Button>
            <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>Add staff</Button>
          </div>
        </div>
      )}

      {subTab === 'archive' && (
        <div className="mb-4">
          <p className="text-sm text-gray-500">Archived staff. Payment history is preserved and can be exported. Teachers whose admin account is deactivated appear here automatically.</p>
        </div>
      )}

      {subTab === 'voided' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Voided staff records and salary payments. Click <span className="font-medium">Restore</span> to bring an item back. After the retention window these are permanently deleted.</p>
          {voidedStaff === null || voidedPayments === null ? <LoadingSpinner /> : (voidedStaff.length === 0 && voidedPayments.length === 0) ? (
            <EmptyState title="Nothing voided" description="Staff or payments you delete will appear here so you can recover them." icon={<ArchiveIcon className="w-8 h-8 text-gray-400" />} />
          ) : (
            <div className="space-y-6">
              {voidedPayments.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Voided payments ({voidedPayments.length})</h4>
                  <div className="space-y-2">
                    {voidedPayments.map(p => (
                      <div key={p.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{fmtMoney(p.amount, p.currency)}</span>
                              <span className="text-xs text-gray-500">· {p.paidOn}</span>
                              {p.periodLabel && <span className="text-xs text-gray-500">· {p.periodLabel}</span>}
                            </div>
                            <div className="text-sm text-gray-700 mt-0.5">{p.staffName ?? '(unknown staff)'}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              Voided {new Date(p.voidedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              {p.voidedByName && <> by <span className="font-medium text-gray-700">{p.voidedByName}</span></>}
                            </div>
                            {p.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{p.voidReason}"</div>}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => unvoidStaffPayment(p.id)} disabled={unvoidBusy === p.id} icon={<RotateCcw className="w-4 h-4" />}>Restore</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {voidedStaff.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Voided staff ({voidedStaff.length})</h4>
                  <div className="space-y-2">
                    {voidedStaff.map(s => (
                      <div key={s.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{s.fullName}</span>
                              {s.position && <span className="text-xs text-gray-500">· {s.position}</span>}
                              <span className="text-sm text-gray-700">{fmtMoney(s.salaryAmount, s.currency)}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Voided {new Date(s.voidedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              {s.voidedByName && <> by <span className="font-medium text-gray-700">{s.voidedByName}</span></>}
                            </div>
                            {s.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{s.voidReason}"</div>}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => unvoidStaff(s.id)} disabled={unvoidBusy === s.id} icon={<RotateCcw className="w-4 h-4" />}>Restore</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subTab !== 'voided' && (list === null ? <LoadingSpinner /> : list.length === 0 ? (
        subTab === 'active' ? (
          <EmptyState title="No staff yet" description="Add a teacher or custom employee to start tracking salaries." icon={<UsersIcon className="w-8 h-8 text-gray-400" />} />
        ) : (
          <EmptyState title="Archive is empty" description="Deactivated or removed staff will appear here." icon={<ArchiveIcon className="w-8 h-8 text-gray-400" />} />
        )
      ) : (
        <div className="space-y-3">
          {list.map(s => {
            const badge = subTab === 'active' && s.isActive ? dueBadge(s.nextPaymentDate) : null;
            const hasInsurance = s.insurancePercentage !== null && s.insurancePercentage !== undefined;
            const insuranceHeld = s.insuranceHeldTotal || 0;
            const showHeldBadge = insuranceHeld > 0 && !s.insurancePaidOut;
            return (
              <div key={s.id} className={`bg-white rounded-2xl border border-gray-200 p-4 ${subTab === 'archive' ? 'opacity-80' : ''}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{s.fullName}</h3>
                      {s.position && <span className="text-xs text-gray-500">· {s.position}</span>}
                      {!s.userId && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">No account</span>}
                      {s.archiveReason && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{s.archiveReason}</span>}
                      {badge && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
                      {hasInsurance && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 inline-flex items-center gap-1">
                          <Shield className="w-3 h-3" /> Insurance {s.insurancePercentage}%
                        </span>
                      )}
                      {showHeldBadge && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          Held: {fmtMoney(insuranceHeld, s.currency)}
                        </span>
                      )}
                      {s.insurancePaidOut && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> Insurance paid {s.insurancePaidOutAt ?? ''}
                        </span>
                      )}
                      {subTab === 'archive' && insuranceHeld > 0 && !s.insurancePaidOut && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Insurance pending payout</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      Salary: <span className="font-semibold text-gray-700">{fmtMoney(s.salaryAmount, s.currency)}</span>
                      {s.nextPaymentDate && subTab === 'active' && <> · Next payment: {s.nextPaymentDate}</>}
                      {s.lastPayment && (
                        <> · Last paid: {fmtMoney(s.lastPayment.amount, s.lastPayment.currency)} on {s.lastPayment.paidOn}
                          {s.lastPayment.insuranceAmount > 0 && (
                            <> (insurance: {fmtMoney(s.lastPayment.insuranceAmount, s.lastPayment.currency)})</>
                          )}
                        </>
                      )}
                    </div>
                    {s.insurancePaidOut && (s.insurancePaidOutAmount ?? 0) > 0 && (
                      <div className="text-xs text-emerald-700 mt-1">
                        Insurance paid out: {fmtMoney(s.insurancePaidOutAmount ?? 0, s.insurancePaidOutCurrency ?? s.currency)} on {s.insurancePaidOutAt ?? '—'}
                        {s.insurancePaidOutNotes && <> · {s.insurancePaidOutNotes}</>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap">
                    {subTab === 'active' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openRecordPayment(s)} icon={<Receipt className="w-4 h-4" />}>Record payment</Button>
                        <Button size="sm" variant="ghost" onClick={() => openHistory(s)} icon={<History className="w-4 h-4" />}>History</Button>
                        {s.userId && (
                          <Button size="sm" variant="ghost" onClick={() => sendReminder(s)} loading={notifyingId === s.id} icon={<BellRing className="w-4 h-4" />}>Send reminder</Button>
                        )}
                        <button onClick={() => openEdit(s)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deactivate(s)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="Archive (deactivate)"><ArchiveIcon className="w-4 h-4" /></button>
                      </>
                    )}
                    {subTab === 'archive' && (
                      <>
                        {!s.insurancePaidOut && insuranceHeld > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => openInsurancePayout(s)} icon={<ShieldCheck className="w-4 h-4" />}>Pay insurance</Button>
                        )}
                        {s.insurancePaidOut && (
                          <Button size="sm" variant="ghost" onClick={() => reverseInsurancePayout(s)} loading={reversingInsuranceId === s.id} icon={<RotateCcw className="w-4 h-4" />}>Reverse insurance</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => exportPdf(s)} loading={exporting === `${s.id}:pdf`} icon={<FileDown className="w-4 h-4" />}>PDF</Button>
                        <Button size="sm" variant="ghost" onClick={() => exportXlsx(s)} loading={exporting === `${s.id}:xlsx`} icon={<FileSpreadsheet className="w-4 h-4" />}>Excel</Button>
                        <Button size="sm" variant="ghost" onClick={() => openHistory(s)} icon={<History className="w-4 h-4" />}>History</Button>
                        {s.userIsActive !== false && (
                          <Button size="sm" variant="ghost" onClick={() => reactivate(s)} loading={reactivatingId === s.id} icon={<RotateCcw className="w-4 h-4" />}>Reactivate</Button>
                        )}
                        <button onClick={() => remove(s)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete permanently"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? 'Edit staff' : 'Add staff'} size="lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Linked teacher / supervisor account (optional)</label>
              <select
                value={editing.userId}
                onChange={e => {
                  const userId = e.target.value;
                  const t = teachers.find(x => x.userId === userId);
                  const sup = !t ? supervisors.find(x => x.userId === userId) : undefined;
                  setEditing({
                    ...editing,
                    userId,
                    fullName: t ? t.fullName : sup ? sup.fullName : editing.fullName,
                    position: t ? (t.subject ? `Teacher · ${t.subject}` : 'Teacher') : sup ? 'Supervisor' : editing.position,
                  });
                }}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— Custom employee (no account) —</option>
                {availableTeachers.length > 0 && (
                  <optgroup label="Teachers">
                    {availableTeachers.map(t => (
                      <option key={t.userId} value={t.userId}>
                        {t.fullName}{t.subject ? ` (${t.subject})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {availableSupervisors.length > 0 && (
                  <optgroup label="Supervisors">
                    {availableSupervisors.map(s => (
                      <option key={s.userId} value={s.userId}>
                        {s.fullName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-gray-500 mt-1">Linked teachers and supervisors receive a push notification when you send a reminder.</p>
            </div>

            <Input label="Full name" value={editing.fullName} onChange={e => setEditing({ ...editing, fullName: e.target.value })} placeholder="e.g. Sarah Ahmed" />
            {!editing.id && (
              <ReturningEmployeeSearch
                role="staff"
                nameQuery={editing.fullName}
                linkedId={editing.previousArchiveId ?? null}
                linkedLabel={staffPrevLabel}
                onPick={(c: ReturningEmployeeCandidate) => {
                  setEditing({ ...editing, fullName: c.fullName, previousArchiveId: c.id });
                  setStaffPrevLabel(`${c.fullName} · ${c.reason}${c.departureDate ? ` ${c.departureDate}` : ''}`);
                }}
                onClear={() => { setEditing({ ...editing, previousArchiveId: null }); setStaffPrevLabel(''); }}
              />
            )}
            <Input label="Position (optional)" value={editing.position} onChange={e => setEditing({ ...editing, position: e.target.value })} placeholder="e.g. Janitor, Bus Driver, Math Teacher" />

            <div className="grid grid-cols-2 gap-3">
              <Input label="Salary amount" type="number" step="0.01" value={editing.salaryAmount} onChange={e => setEditing({ ...editing, salaryAmount: e.target.value })} />
              <Input label="Currency" value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
            </div>

            <Input label="Next payment date (optional)" type="date" value={editing.nextPaymentDate} onChange={e => setEditing({ ...editing, nextPaymentDate: e.target.value })} />

            <div>
              <Input
                label="Insurance % (optional)"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={editing.insurancePercentage}
                onChange={e => setEditing({ ...editing, insurancePercentage: e.target.value })}
                placeholder="e.g. 5"
              />
              <p className="text-xs text-gray-500 mt-1">Percentage withheld from each salary payment as insurance. The accumulated amount is paid out when the staff member leaves. Leave blank for no insurance.</p>
            </div>

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

      {paymentTarget && paymentForm && (() => {
        const grossN = Number(paymentForm.amount) || 0;
        const insN = Number(paymentForm.insuranceAmount) || 0;
        const netN = Math.max(0, Math.round((grossN - insN) * 100) / 100);
        return (
          <Modal isOpen onClose={() => { setPaymentTarget(null); setPaymentForm(null); }} title={`Record payment — ${paymentTarget.fullName}`} size="lg">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Gross amount"
                  type="number"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={e => {
                    const newAmt = e.target.value;
                    const pct = Number(paymentForm.insurancePercentage);
                    const a = Number(newAmt);
                    const next: PaymentForm = { ...paymentForm, amount: newAmt };
                    if (!paymentForm.insuranceTouched && !isNaN(a) && !isNaN(pct) && pct > 0) {
                      next.insuranceAmount = String(Math.round((a * pct) / 100 * 100) / 100);
                    }
                    setPaymentForm(next);
                  }}
                />
                <Input label="Currency" value={paymentForm.currency} onChange={e => setPaymentForm({ ...paymentForm, currency: e.target.value.toUpperCase() })} />
              </div>
              <Input label="Payment date" type="date" value={paymentForm.paidOn} onChange={e => setPaymentForm({ ...paymentForm, paidOn: e.target.value })} />
              <Input label="Period label (optional)" value={paymentForm.periodLabel} onChange={e => setPaymentForm({ ...paymentForm, periodLabel: e.target.value })} placeholder="e.g. May 2026" />

              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-semibold text-gray-700">Insurance withholding</h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Insurance %"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={paymentForm.insurancePercentage}
                    onChange={e => {
                      const pctStr = e.target.value;
                      const pct = Number(pctStr);
                      const a = Number(paymentForm.amount);
                      const next: PaymentForm = { ...paymentForm, insurancePercentage: pctStr };
                      if (!paymentForm.insuranceTouched) {
                        if (pctStr.trim() === '' || isNaN(pct)) next.insuranceAmount = '';
                        else if (!isNaN(a)) next.insuranceAmount = String(Math.round((a * pct) / 100 * 100) / 100);
                      }
                      setPaymentForm(next);
                    }}
                  />
                  <Input
                    label="Insurance amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentForm.insuranceAmount}
                    onChange={e => setPaymentForm({ ...paymentForm, insuranceAmount: e.target.value, insuranceTouched: true })}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-gray-500">Gross</div>
                    <div className="font-semibold text-gray-900">{fmtMoney(grossN, paymentForm.currency)}</div>
                  </div>
                  <div className="bg-indigo-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-indigo-600">Insurance</div>
                    <div className="font-semibold text-indigo-900">{fmtMoney(insN, paymentForm.currency)}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-emerald-700">Net paid</div>
                    <div className="font-semibold text-emerald-900">{fmtMoney(netN, paymentForm.currency)}</div>
                  </div>
                </div>
              </div>

              {accounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Paid from</label>
                  <select
                    value={paymentForm.paymentAccountId}
                    onChange={e => setPaymentForm({ ...paymentForm, paymentAccountId: e.target.value })}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">— No specific account —</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.kind} · {a.currency})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Cash leaves this account's running balance when the payment is recorded.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Tax included (optional)"
                  type="number"
                  step="0.01"
                  value={paymentForm.taxAmount}
                  onChange={e => setPaymentForm({ ...paymentForm, taxAmount: e.target.value })}
                  placeholder="0.00"
                />
                <Input
                  label="Tax label"
                  value={paymentForm.taxLabel}
                  onChange={e => setPaymentForm({ ...paymentForm, taxLabel: e.target.value })}
                  placeholder="Income tax, etc."
                />
              </div>
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
        );
      })()}

      {historyTarget && (
        <Modal isOpen onClose={() => { setHistoryTarget(null); setHistory(null); }} title={`Payment history — ${historyTarget.fullName}`} size="xl">
          {history === null ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No payments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map(p => {
                const ins = p.insuranceAmount || 0;
                const net = Math.round((p.amount - ins) * 100) / 100;
                return (
                  <div key={p.id} className="flex items-start justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="font-semibold text-gray-900">{fmtMoney(p.amount, p.currency)}</span>
                        {ins > 0 && (
                          <span className="text-xs text-indigo-700">− insurance {fmtMoney(ins, p.currency)}{p.insurancePercentage !== null && p.insurancePercentage !== undefined ? ` (${p.insurancePercentage}%)` : ''}</span>
                        )}
                        {ins > 0 && (
                          <span className="text-xs font-semibold text-emerald-700">net {fmtMoney(net, p.currency)}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Paid on {p.paidOn}
                        {p.periodLabel && <> · {p.periodLabel}</>}
                      </div>
                      {p.notes && <div className="text-xs text-gray-600 mt-1">{p.notes}</div>}
                    </div>
                    {historyTarget.effectiveActive && (
                      <button onClick={() => deletePaymentEntry(p)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
              {(() => {
                const same = history.filter(p => p.currency === historyTarget.currency);
                if (same.length === 0) return null;
                const totalGross = same.reduce((s, p) => s + p.amount, 0);
                const totalIns = same.reduce((s, p) => s + (p.insuranceAmount || 0), 0);
                const totalNet = Math.round((totalGross - totalIns) * 100) / 100;
                if (totalIns === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-gray-500">Total gross</div>
                      <div className="font-semibold text-gray-900">{fmtMoney(totalGross, historyTarget.currency)}</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-indigo-600">Insurance withheld</div>
                      <div className="font-semibold text-indigo-900">{fmtMoney(totalIns, historyTarget.currency)}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-emerald-700">Total net</div>
                      <div className="font-semibold text-emerald-900">{fmtMoney(totalNet, historyTarget.currency)}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </Modal>
      )}

      {insurancePayoutTarget && insurancePayoutForm && (
        <Modal isOpen onClose={() => { setInsurancePayoutTarget(null); setInsurancePayoutForm(null); }} title={`Pay insurance — ${insurancePayoutTarget.fullName}`} size="lg">
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <div className="text-xs text-indigo-700 font-semibold uppercase tracking-wide">Insurance held</div>
              <div className="text-xl font-bold text-indigo-900 mt-1">{fmtMoney(insurancePayoutTarget.insuranceHeldTotal || 0, insurancePayoutTarget.currency)}</div>
              <div className="text-xs text-indigo-700 mt-1">Total withheld across all recorded salary payments.</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Payout amount" type="number" step="0.01" min="0" value={insurancePayoutForm.amount} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, amount: e.target.value })} />
              <Input label="Currency" value={insurancePayoutForm.currency} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, currency: e.target.value.toUpperCase() })} />
            </div>
            <Input label="Payout date" type="date" value={insurancePayoutForm.paidOn} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, paidOn: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea
                value={insurancePayoutForm.notes}
                onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, notes: e.target.value })}
                rows={3}
                placeholder="e.g. End-of-contract insurance settlement"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <p className="text-xs text-gray-500">This records the insurance settlement on the staff member's archive entry. You can reverse it later if needed.</p>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => { setInsurancePayoutTarget(null); setInsurancePayoutForm(null); }}>Cancel</Button>
              <Button onClick={submitInsurancePayout} loading={savingInsurancePayout}>Mark insurance paid</Button>
            </div>
          </div>
        </Modal>
      )}

      {bulkNextPayment && (
        <Modal isOpen onClose={() => setBulkNextPayment(null)} title="Set next payment for all" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Apply a single next payment date to multiple active staff members at once. Leave the date blank to clear it for the selected staff.</p>

            <Input
              label="Next payment date"
              type="date"
              value={bulkNextPayment.date}
              onChange={e => setBulkNextPayment({ ...bulkNextPayment, date: e.target.value })}
            />

            {!bulkNextPayment.date && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Date is empty — selected staff will have their next payment date cleared.
              </p>
            )}

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">
                  {bulkNextPayment.selectedIds.size} of {active?.length ?? 0} selected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!active) return;
                    const allSelected = bulkNextPayment.selectedIds.size === active.length;
                    setBulkNextPayment({
                      ...bulkNextPayment,
                      selectedIds: allSelected ? new Set() : new Set(active.map(s => s.id)),
                    });
                  }}
                  className="text-sm text-primary-600 hover:underline font-medium"
                >
                  {bulkNextPayment.selectedIds.size === (active?.length ?? 0) && (active?.length ?? 0) > 0 ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                {(active ?? []).map(s => {
                  const checked = bulkNextPayment.selectedIds.has(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const next = new Set(bulkNextPayment.selectedIds);
                          if (e.target.checked) next.add(s.id); else next.delete(s.id);
                          setBulkNextPayment({ ...bulkNextPayment, selectedIds: next });
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{s.fullName}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {s.position ?? 'Staff'}
                          {s.nextPaymentDate ? <> · current: {s.nextPaymentDate}</> : <> · no date set</>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setBulkNextPayment(null)}>Cancel</Button>
              <Button onClick={submitBulkNextPayment} loading={savingBulkNext} disabled={bulkNextPayment.selectedIds.size === 0}>
                {bulkNextPayment.date ? `Apply to ${bulkNextPayment.selectedIds.size}` : `Clear for ${bulkNextPayment.selectedIds.size}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {massReminder && (
        <Modal isOpen onClose={() => setMassReminder(null)} title="Send mass salary reminder" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Sends a push and in-app notification to every active staff member with a linked teacher account. Leave the title and message blank to use the default (which is auto-translated for each teacher).</p>

            <Input label="Custom title (optional)" value={massReminder.title} onChange={e => setMassReminder({ ...massReminder, title: e.target.value })} placeholder="Salary payment due" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Custom message (optional)</label>
              <textarea
                value={massReminder.message}
                onChange={e => setMassReminder({ ...massReminder, message: e.target.value })}
                rows={3}
                placeholder="Leave blank to use the default per-staff message with their amount and date."
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={massReminder.onlyDueSoon} onChange={e => setMassReminder({ ...massReminder, onlyDueSoon: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              Only send to staff with payment due within
            </label>
            {massReminder.onlyDueSoon && (
              <div className="flex items-center gap-2 ml-6">
                <Input label="" type="number" min="0" value={massReminder.dueWithinDays} onChange={e => setMassReminder({ ...massReminder, dueWithinDays: e.target.value })} />
                <span className="text-sm text-gray-500">days</span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setMassReminder(null)}>Cancel</Button>
              <Button onClick={sendMassReminder} loading={sendingMass}>Send reminders</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
