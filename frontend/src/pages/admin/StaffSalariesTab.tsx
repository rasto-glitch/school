import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Virtuoso } from 'react-virtuoso';
import { staffApi, accountingApi, drainPages, type PaymentAccount } from '../../services/api';
import { fmtMoney } from '../../utils/money';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { Plus, Trash2, Pencil, Users as UsersIcon, BellRing, Receipt, History, Megaphone, Archive as ArchiveIcon, RotateCcw, FileDown, FileSpreadsheet, Shield, ShieldCheck, CalendarClock } from 'lucide-react';
import type { StaffMember, StaffSalaryPayment, StaffSetupTeacher, StaffSetupSupervisor, StaffSetupAdmin } from '../../types';

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

function dueBadge(dateStr: string | null, t: TFunction): { text: string; cls: string } | null {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d < 0) return { text: t('accounting.staff.overdue_days', { count: Math.abs(d) }), cls: 'bg-red-100 text-red-700' };
  if (d === 0) return { text: t('accounting.staff.due_today'), cls: 'bg-amber-100 text-amber-800' };
  if (d <= 3) return { text: t('accounting.staff.due_in_days', { count: d }), cls: 'bg-amber-100 text-amber-800' };
  if (d <= 7) return { text: t('accounting.staff.due_in_days', { count: d }), cls: 'bg-yellow-50 text-yellow-700' };
  return { text: t('accounting.staff.due_in_days', { count: d }), cls: 'bg-gray-100 text-gray-600' };
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
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<SubTab>('active');
  const [active, setActive] = useState<StaffMember[] | null>(null);
  const [archived, setArchived] = useState<StaffMember[] | null>(null);
  const [voidedStaff, setVoidedStaff] = useState<VoidedStaffRow[] | null>(null);
  const [voidedPayments, setVoidedPayments] = useState<VoidedStaffPaymentRow[] | null>(null);
  const [unvoidBusy, setUnvoidBusy] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<StaffSetupTeacher[]>([]);
  const [supervisors, setSupervisors] = useState<StaffSetupSupervisor[]>([]);
  const [admins, setAdmins] = useState<StaffSetupAdmin[]>([]);
  const [editing, setEditing] = useState<StaffForm | null>(null);
  const [saving, setSaving] = useState(false);
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
  // Whole-set per-currency totals for the history modal summary — computed
  // by the backend over ALL payments, never the loaded page.
  const [historyTotals, setHistoryTotals] = useState<{ currency: string; gross: number; insurance: number; net: number; count: number }[]>([]);
  const historyCursor = useRef<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

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
    setAdmins((r.data.admins ?? []) as StaffSetupAdmin[]);
  };
  const loadAll = () => Promise.all([loadActive(), loadArchive()]);
  const loadVoided = async () => {
    const [s, p] = await Promise.all([
      drainPages<VoidedStaffRow>(c => staffApi.listVoided(c)),
      drainPages<VoidedStaffPaymentRow>(c => staffApi.listVoidedPayments(c)),
    ]);
    setVoidedStaff(s);
    setVoidedPayments(p);
  };

  useEffect(() => {
    loadAll().catch((e: any) => toast.error(e.response?.data?.error || t('accounting.staff.load_failed')));
    loadSetup().catch(() => {});
    // Only show active accounts in the payment "paid from" picker so retired tills don't clutter it.
    accountingApi.listPaymentAccounts().then(r => setAccounts(r.data.filter(a => a.isActive))).catch(() => {});
  }, []);

  useEffect(() => {
    if (subTab === 'voided' && (voidedStaff === null || voidedPayments === null)) {
      loadVoided().catch((e: any) => toast.error(e.response?.data?.error || t('accounting.staff.load_failed_voided')));
    }
  }, [subTab]);

  const unvoidStaff = async (id: string) => {
    if (!confirm(t('accounting.staff.confirm_restore_staff'))) return;
    setUnvoidBusy(id);
    try {
      await staffApi.unvoid(id);
      toast.success(t('accounting.staff.staff_restored'));
      await Promise.all([loadVoided(), loadAll()]);
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.staff.failed_restore')); }
    finally { setUnvoidBusy(null); }
  };

  const unvoidStaffPayment = async (id: string) => {
    if (!confirm(t('accounting.staff.confirm_restore_payment'))) return;
    setUnvoidBusy(id);
    try {
      await staffApi.unvoidPayment(id);
      toast.success(t('accounting.staff.payment_restored'));
      await loadVoided();
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.staff.failed_restore')); }
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
    if (!editing.id && !editing.userId) { toast.error(t('accounting.staff.err_pick_employee')); return; }
    if (isNaN(total) || total < 0) { toast.error(t('accounting.staff.err_salary_required')); return; }
    if (!editing.fullName.trim()) { toast.error(t('accounting.staff.err_name_required')); return; }
    if (!editing.currency.trim()) { toast.error(t('accounting.staff.err_currency_required')); return; }

    let insurancePct: number | null = null;
    if (editing.insurancePercentage.trim() !== '') {
      const pct = Number(editing.insurancePercentage);
      if (isNaN(pct) || pct < 0 || pct > 100) { toast.error(t('accounting.staff.err_insurance_pct')); return; }
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
        toast.success(t('accounting.staff.salary_updated'));
      } else {
        await staffApi.create(body);
        toast.success(t('accounting.staff.added_payroll'));
      }
      setEditing(null);
      await Promise.all([loadAll(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_save'));
    } finally { setSaving(false); }
  };

  const deactivate = async (s: StaffMember) => {
    if (!confirm(t('accounting.staff.confirm_deactivate', { name: s.fullName }))) return;
    try {
      await staffApi.update(s.id, { isActive: false });
      toast.success(t('accounting.staff.staff_archived'));
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_deactivate'));
    }
  };

  const reactivate = async (s: StaffMember) => {
    if (s.userIsActive === false) {
      toast.error(t('accounting.staff.reactivate_account_first'));
      return;
    }
    setReactivatingId(s.id);
    try {
      await staffApi.update(s.id, { isActive: true });
      toast.success(t('accounting.staff.staff_reactivated'));
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_reactivate'));
    } finally { setReactivatingId(null); }
  };

  const remove = async (s: StaffMember) => {
    if (!confirm(t('accounting.staff.confirm_delete', { name: s.fullName }))) return;
    try {
      await staffApi.remove(s.id);
      toast.success(t('accounting.staff.staff_deleted'));
      await Promise.all([loadAll(), loadSetup()]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_delete'));
    }
  };

  const sendReminder = async (s: StaffMember) => {
    if (!s.userId) { toast.info(t('accounting.staff.no_linked_account')); return; }
    setNotifyingId(s.id);
    try {
      await staffApi.notifyDue(s.id);
      toast.success(t('accounting.staff.reminder_sent', { name: s.fullName }));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_reminder'));
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
      paymentAccountId: accounts[0]?.id ?? '', // default to the primary account
    });
  };

  const submitPayment = async () => {
    if (!paymentTarget || !paymentForm) return;
    const amt = Number(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) { toast.error(t('accounting.staff.err_amount_gt0')); return; }
    if (!paymentForm.paidOn) { toast.error(t('accounting.staff.err_payment_date')); return; }
    if (!paymentForm.paymentAccountId) { toast.error(t('accounting.staff.err_choose_account')); return; }

    let insAmt: number | null = null;
    if (paymentForm.insuranceAmount.trim() !== '') {
      const v = Number(paymentForm.insuranceAmount);
      if (isNaN(v) || v < 0) { toast.error(t('accounting.staff.err_insurance_nonneg')); return; }
      if (v > amt) { toast.error(t('accounting.staff.err_insurance_exceeds')); return; }
      insAmt = Math.round(v * 100) / 100;
    }
    let insPct: number | null = null;
    if (paymentForm.insurancePercentage.trim() !== '') {
      const v = Number(paymentForm.insurancePercentage);
      if (isNaN(v) || v < 0 || v > 100) { toast.error(t('accounting.staff.err_insurance_pct')); return; }
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
        paymentAccountId: paymentForm.paymentAccountId,
      });
      toast.success(t('accounting.staff.payment_recorded'));
      setPaymentTarget(null);
      setPaymentForm(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_record_payment'));
    } finally { setSavingPayment(false); }
  };

  // Loads page 1 of a staff member's payment history (resets accumulation)
  // and captures the whole-set per-currency totals for the summary.
  const fetchHistory = useCallback(async (staffId: string) => {
    setHistory(null);
    historyCursor.current = null;
    try {
      const r = await staffApi.listPayments(staffId);
      setHistory(r.data.data);
      setHistoryTotals(r.data.totals);
      historyCursor.current = r.data.nextCursor;
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_load_history'));
      setHistoryTarget(null);
    }
  }, []);

  const openHistory = async (s: StaffMember) => {
    setHistoryTarget(s);
    await fetchHistory(s.id);
  };

  const loadHistoryMore = useCallback(async () => {
    if (!historyTarget || historyLoadingMore || !historyCursor.current) return;
    setHistoryLoadingMore(true);
    try {
      const r = await staffApi.listPayments(historyTarget.id, historyCursor.current);
      historyCursor.current = r.data.nextCursor;
      setHistory(prev => [...(prev ?? []), ...r.data.data]);
    } catch {
      // keep what we have; next scroll retries
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [historyTarget, historyLoadingMore]);

  const deletePaymentEntry = async (p: StaffSalaryPayment) => {
    if (!historyTarget) return;
    if (!confirm(t('accounting.staff.confirm_delete_payment', { amount: fmtMoney(p.amount, p.currency), date: p.paidOn }))) return;
    try {
      await staffApi.deletePayment(p.id);
      toast.success(t('accounting.staff.payment_deleted'));
      await fetchHistory(historyTarget.id);
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_delete_payment'));
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
    if (isNaN(amt) || amt < 0) { toast.error(t('accounting.staff.err_amount_nonneg')); return; }
    if (!insurancePayoutForm.paidOn) { toast.error(t('accounting.staff.err_date_required')); return; }

    setSavingInsurancePayout(true);
    try {
      await staffApi.payInsurance(insurancePayoutTarget.id, {
        paidOn: insurancePayoutForm.paidOn,
        amount: amt,
        currency: insurancePayoutForm.currency.toUpperCase(),
        notes: insurancePayoutForm.notes.trim() || null,
      });
      toast.success(t('accounting.staff.insurance_marked_paid'));
      setInsurancePayoutTarget(null);
      setInsurancePayoutForm(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_mark_insurance'));
    } finally { setSavingInsurancePayout(false); }
  };

  const reverseInsurancePayout = async (s: StaffMember) => {
    if (!confirm(t('accounting.staff.confirm_reverse_insurance', { name: s.fullName }))) return;
    setReversingInsuranceId(s.id);
    try {
      await staffApi.reverseInsurancePayout(s.id);
      toast.success(t('accounting.staff.insurance_reversed'));
      await loadAll();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_reverse_payout'));
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
    if (bulkNextPayment.selectedIds.size === 0) { toast.error(t('accounting.staff.err_select_one')); return; }
    if (bulkNextPayment.date && !/^\d{4}-\d{2}-\d{2}$/.test(bulkNextPayment.date)) {
      toast.error(t('accounting.staff.err_valid_date')); return;
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
          ? t('accounting.staff.bulk_set_done', { count: n })
          : t('accounting.staff.bulk_cleared_done', { count: n })
      );
      setBulkNextPayment(null);
      await loadActive();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_update'));
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
      toast.success(count === 0 ? t('accounting.staff.no_staff_matched') : t('accounting.staff.reminders_sent', { count }));
      setMassReminder(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_send_reminders'));
    } finally { setSendingMass(false); }
  };

  const exportPdf = async (s: StaffMember) => {
    setExporting(`${s.id}:pdf`);
    try {
      const r = await staffApi.downloadSalaryPdf(s.id);
      downloadBlob(r.data as Blob, `salary-${s.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_pdf'));
    } finally { setExporting(null); }
  };

  const exportXlsx = async (s: StaffMember) => {
    setExporting(`${s.id}:xlsx`);
    try {
      const r = await staffApi.downloadSalaryXlsx(s.id);
      downloadBlob(r.data as Blob, `salary-${s.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.xlsx`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.staff.failed_excel'));
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

  const availableAdmins = useMemo(() => {
    if (!editing) return admins;
    return admins.filter(a => !a.alreadyLinked || a.userId === editing.userId);
  }, [admins, editing]);

  const list = subTab === 'active' ? active : archived;

  return (
    <div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
        <button
          onClick={() => setSubTab('active')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >{t('accounting.staff.tab_active')}{active && ` (${active.length})`}</button>
        <button
          onClick={() => setSubTab('archive')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'archive' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >{t('accounting.staff.tab_archive')}{archived && ` (${archived.length})`}</button>
        <button
          onClick={() => setSubTab('voided')}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${subTab === 'voided' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >{t('accounting.staff.tab_voided')}{voidedStaff && voidedPayments && ` (${voidedStaff.length + voidedPayments.length})`}</button>
      </div>

      {subTab === 'active' && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">{t('accounting.staff.active_hint')}</p>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" onClick={openBulkNextPayment} icon={<CalendarClock className="w-4 h-4" />}>{t('accounting.staff.set_next_payment')}</Button>
            <Button variant="ghost" onClick={() => setMassReminder({ ...emptyMass })} icon={<Megaphone className="w-4 h-4" />}>{t('accounting.staff.mass_reminder')}</Button>
            <Button onClick={openNew} icon={<Plus className="w-4 h-4" />}>{t('accounting.staff.add_payroll')}</Button>
          </div>
        </div>
      )}

      {subTab === 'archive' && (
        <div className="mb-4">
          <p className="text-sm text-gray-500">{t('accounting.staff.archive_hint')}</p>
        </div>
      )}

      {subTab === 'voided' && (
        <div>
          <p className="text-sm text-gray-500 mb-4"><Trans i18nKey="accounting.staff.voided_hint" components={{ b: <span className="font-medium" /> }} /></p>
          {voidedStaff === null || voidedPayments === null ? <LoadingSpinner /> : (voidedStaff.length === 0 && voidedPayments.length === 0) ? (
            <EmptyState title={t('accounting.staff.voided_empty_title')} description={t('accounting.staff.voided_empty_desc')} icon={<ArchiveIcon className="w-8 h-8 text-gray-400" />} />
          ) : (
            <div className="space-y-6">
              {voidedPayments.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">{t('accounting.staff.voided_payments', { count: voidedPayments.length })}</h4>
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
                            <div className="text-sm text-gray-700 mt-0.5">{p.staffName ?? t('accounting.staff.unknown_staff')}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {t('accounting.staff.voided_at', { date: new Date(p.voidedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) })}
                              {p.voidedByName && <> {t('accounting.staff.by')} <span className="font-medium text-gray-700">{p.voidedByName}</span></>}
                            </div>
                            {p.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{p.voidReason}"</div>}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => unvoidStaffPayment(p.id)} disabled={unvoidBusy === p.id} icon={<RotateCcw className="w-4 h-4" />}>{t('accounting.staff.restore')}</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {voidedStaff.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">{t('accounting.staff.voided_staff', { count: voidedStaff.length })}</h4>
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
                              {t('accounting.staff.voided_at', { date: new Date(s.voidedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) })}
                              {s.voidedByName && <> {t('accounting.staff.by')} <span className="font-medium text-gray-700">{s.voidedByName}</span></>}
                            </div>
                            {s.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{s.voidReason}"</div>}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => unvoidStaff(s.id)} disabled={unvoidBusy === s.id} icon={<RotateCcw className="w-4 h-4" />}>{t('accounting.staff.restore')}</Button>
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
          <EmptyState title={t('accounting.staff.payroll_empty_title')} description={t('accounting.staff.payroll_empty_desc')} icon={<UsersIcon className="w-8 h-8 text-gray-400" />} />
        ) : (
          <EmptyState title={t('accounting.staff.archive_empty_title')} description={t('accounting.staff.archive_empty_desc')} icon={<ArchiveIcon className="w-8 h-8 text-gray-400" />} />
        )
      ) : (
        <div className="space-y-3">
          {list.map(s => {
            const badge = subTab === 'active' && s.isActive ? dueBadge(s.nextPaymentDate, t) : null;
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
                      {!s.userId && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('accounting.staff.no_account')}</span>}
                      {s.archiveReason && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{s.archiveReason}</span>}
                      {badge && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
                      {hasInsurance && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 inline-flex items-center gap-1">
                          <Shield className="w-3 h-3" /> {t('accounting.staff.insurance_pct_badge', { pct: s.insurancePercentage })}
                        </span>
                      )}
                      {showHeldBadge && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {t('accounting.staff.held_badge', { amount: fmtMoney(insuranceHeld, s.currency) })}
                        </span>
                      )}
                      {s.insurancePaidOut && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> {t('accounting.staff.insurance_paid_badge', { date: s.insurancePaidOutAt ?? '' })}
                        </span>
                      )}
                      {subTab === 'archive' && insuranceHeld > 0 && !s.insurancePaidOut && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{t('accounting.staff.insurance_pending')}</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {t('accounting.staff.salary_label')}: <span className="font-semibold text-gray-700">{fmtMoney(s.salaryAmount, s.currency)}</span>
                      {s.nextPaymentDate && subTab === 'active' && <> · {t('accounting.staff.next_payment_inline', { date: s.nextPaymentDate })}</>}
                      {s.lastPayment && (
                        <> · {t('accounting.staff.last_paid_inline', { amount: fmtMoney(s.lastPayment.amount, s.lastPayment.currency), date: s.lastPayment.paidOn })}
                          {s.lastPayment.insuranceAmount > 0 && (
                            <> {t('accounting.staff.last_paid_insurance', { amount: fmtMoney(s.lastPayment.insuranceAmount, s.lastPayment.currency) })}</>
                          )}
                        </>
                      )}
                    </div>
                    {s.insurancePaidOut && (s.insurancePaidOutAmount ?? 0) > 0 && (
                      <div className="text-xs text-emerald-700 mt-1">
                        {t('accounting.staff.insurance_paid_out_inline', { amount: fmtMoney(s.insurancePaidOutAmount ?? 0, s.insurancePaidOutCurrency ?? s.currency), date: s.insurancePaidOutAt ?? '—' })}
                        {s.insurancePaidOutNotes && <> · {s.insurancePaidOutNotes}</>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap">
                    {subTab === 'active' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openRecordPayment(s)} icon={<Receipt className="w-4 h-4" />}>{t('accounting.staff.record_payment')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => openHistory(s)} icon={<History className="w-4 h-4" />}>{t('accounting.staff.history')}</Button>
                        {s.userId && (
                          <Button size="sm" variant="ghost" onClick={() => sendReminder(s)} loading={notifyingId === s.id} icon={<BellRing className="w-4 h-4" />}>{t('accounting.staff.send_reminder')}</Button>
                        )}
                        <button onClick={() => openEdit(s)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title={t('common.edit')}><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deactivate(s)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title={t('accounting.staff.archive_deactivate')}><ArchiveIcon className="w-4 h-4" /></button>
                      </>
                    )}
                    {subTab === 'archive' && (
                      <>
                        {!s.insurancePaidOut && insuranceHeld > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => openInsurancePayout(s)} icon={<ShieldCheck className="w-4 h-4" />}>{t('accounting.staff.pay_insurance')}</Button>
                        )}
                        {s.insurancePaidOut && (
                          <Button size="sm" variant="ghost" onClick={() => reverseInsurancePayout(s)} loading={reversingInsuranceId === s.id} icon={<RotateCcw className="w-4 h-4" />}>{t('accounting.staff.reverse_insurance')}</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => exportPdf(s)} loading={exporting === `${s.id}:pdf`} icon={<FileDown className="w-4 h-4" />}>{t('accounting.archive.pdf')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => exportXlsx(s)} loading={exporting === `${s.id}:xlsx`} icon={<FileSpreadsheet className="w-4 h-4" />}>{t('accounting.archive.excel')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => openHistory(s)} icon={<History className="w-4 h-4" />}>{t('accounting.staff.history')}</Button>
                        {s.userIsActive !== false && (
                          <Button size="sm" variant="ghost" onClick={() => reactivate(s)} loading={reactivatingId === s.id} icon={<RotateCcw className="w-4 h-4" />}>{t('accounting.staff.reactivate')}</Button>
                        )}
                        <button onClick={() => remove(s)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title={t('accounting.staff.delete_permanently')}><Trash2 className="w-4 h-4" /></button>
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
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? t('accounting.staff.edit_salary') : t('accounting.staff.add_payroll')} size="lg">
          <div className="space-y-4">
            {!editing.id ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.staff.employee')}</label>
                <select
                  value={editing.userId}
                  onChange={e => {
                    const userId = e.target.value;
                    const tch = teachers.find(x => x.userId === userId);
                    const sup = !tch ? supervisors.find(x => x.userId === userId) : undefined;
                    const adm = !tch && !sup ? admins.find(x => x.userId === userId) : undefined;
                    setEditing({
                      ...editing,
                      userId,
                      fullName: tch ? tch.fullName : sup ? sup.fullName : adm ? adm.fullName : '',
                      position: tch ? (tch.subject ? t('accounting.staff.pos_teacher_subject', { subject: tch.subject }) : t('accounting.staff.pos_teacher')) : sup ? t('accounting.staff.pos_supervisor') : adm ? t('accounting.staff.pos_administrator') : '',
                    });
                  }}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t('accounting.staff.select_employee')}</option>
                  {availableTeachers.length > 0 && (
                    <optgroup label={t('accounting.staff.grp_teachers')}>
                      {availableTeachers.map(tch => (
                        <option key={tch.userId} value={tch.userId}>
                          {tch.fullName}{tch.subject ? ` (${tch.subject})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {availableSupervisors.length > 0 && (
                    <optgroup label={t('accounting.staff.grp_supervisors')}>
                      {availableSupervisors.map(s => (
                        <option key={s.userId} value={s.userId}>{s.fullName}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableAdmins.length > 0 && (
                    <optgroup label={t('accounting.staff.grp_administration')}>
                      {availableAdmins.map(a => (
                        <option key={a.userId} value={a.userId}>{a.fullName}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {t('accounting.staff.employee_hint')}
                </p>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">{editing.fullName}</div>
                {editing.position && <div className="text-xs text-gray-500 mt-0.5">{editing.position}</div>}
                <div className="text-xs text-gray-400 mt-1">{t('accounting.staff.name_position_managed')}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounting.staff.salary_amount')} type="number" step="0.01" value={editing.salaryAmount} onChange={e => setEditing({ ...editing, salaryAmount: e.target.value })} />
              <Input label={t('accounting.staff.currency')} value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} />
            </div>

            <Input label={t('accounting.staff.next_payment_optional')} type="date" value={editing.nextPaymentDate} onChange={e => setEditing({ ...editing, nextPaymentDate: e.target.value })} />

            <div>
              <Input
                label={t('accounting.staff.insurance_pct_optional')}
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={editing.insurancePercentage}
                onChange={e => setEditing({ ...editing, insurancePercentage: e.target.value })}
                placeholder={t('accounting.staff.ph_insurance_pct')}
              />
              <p className="text-xs text-gray-500 mt-1">{t('accounting.staff.insurance_hint')}</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              {t('accounting.staff.active_checkbox')}
            </label>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button onClick={save} loading={saving}>{editing.id ? t('accounting.staff.save_changes') : t('accounting.staff.add_payroll')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {paymentTarget && paymentForm && (() => {
        const grossN = Number(paymentForm.amount) || 0;
        const insN = Number(paymentForm.insuranceAmount) || 0;
        const netN = Math.max(0, Math.round((grossN - insN) * 100) / 100);
        return (
          <Modal isOpen onClose={() => { setPaymentTarget(null); setPaymentForm(null); }} title={t('accounting.staff.record_payment_title', { name: paymentTarget.fullName })} size="lg">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('accounting.staff.gross_amount')}
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
                <Input label={t('accounting.staff.currency')} value={paymentForm.currency} onChange={e => setPaymentForm({ ...paymentForm, currency: e.target.value.toUpperCase() })} />
              </div>
              <Input label={t('accounting.staff.payment_date')} type="date" value={paymentForm.paidOn} onChange={e => setPaymentForm({ ...paymentForm, paidOn: e.target.value })} />
              <Input label={t('accounting.staff.period_label')} value={paymentForm.periodLabel} onChange={e => setPaymentForm({ ...paymentForm, periodLabel: e.target.value })} placeholder={t('accounting.staff.ph_period')} />

              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-semibold text-gray-700">{t('accounting.staff.insurance_withholding')}</h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('accounting.staff.insurance_pct')}
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
                    label={t('accounting.staff.insurance_amount')}
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentForm.insuranceAmount}
                    onChange={e => setPaymentForm({ ...paymentForm, insuranceAmount: e.target.value, insuranceTouched: true })}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-gray-500">{t('accounting.staff.gross')}</div>
                    <div className="font-semibold text-gray-900">{fmtMoney(grossN, paymentForm.currency)}</div>
                  </div>
                  <div className="bg-indigo-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-indigo-600">{t('accounting.staff.insurance')}</div>
                    <div className="font-semibold text-indigo-900">{fmtMoney(insN, paymentForm.currency)}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg py-2 px-3">
                    <div className="text-xs text-emerald-700">{t('accounting.staff.net_paid')}</div>
                    <div className="font-semibold text-emerald-900">{fmtMoney(netN, paymentForm.currency)}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.staff.paid_from')} <span className="text-rose-500">*</span></label>
                {accounts.length > 0 ? (
                  <>
                    <select
                      value={paymentForm.paymentAccountId}
                      onChange={e => setPaymentForm({ ...paymentForm, paymentAccountId: e.target.value })}
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({a.kind} · {a.currency})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">{t('accounting.staff.paid_from_hint')}</p>
                  </>
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('accounting.staff.no_accounts_warning')}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('accounting.staff.tax_included')}
                  type="number"
                  step="0.01"
                  value={paymentForm.taxAmount}
                  onChange={e => setPaymentForm({ ...paymentForm, taxAmount: e.target.value })}
                  placeholder="0.00"
                />
                <Input
                  label={t('accounting.staff.tax_label')}
                  value={paymentForm.taxLabel}
                  onChange={e => setPaymentForm({ ...paymentForm, taxLabel: e.target.value })}
                  placeholder={t('accounting.staff.ph_tax_label')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.staff.notes_optional')}</label>
                <textarea
                  value={paymentForm.notes}
                  onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              {paymentTarget.userId && (
                <p className="text-xs text-gray-500">{t('accounting.staff.confirmation_notice', { name: paymentTarget.fullName })}</p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={() => { setPaymentTarget(null); setPaymentForm(null); }}>{t('common.cancel')}</Button>
                <Button onClick={submitPayment} loading={savingPayment}>{t('accounting.staff.record_payment')}</Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {historyTarget && (
        <Modal isOpen onClose={() => { setHistoryTarget(null); setHistory(null); }} title={t('accounting.staff.history_title', { name: historyTarget.fullName })} size="xl">
          {history === null ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">{t('accounting.staff.no_payments_yet')}</p>
          ) : (
            <div>
              <Virtuoso
                style={{ height: '60vh' }}
                data={history}
                increaseViewportBy={400}
                // Seamless background load while the user reads — no button.
                endReached={() => loadHistoryMore()}
                components={{
                  Item: (props) => <div {...props} style={{ ...props.style, paddingBottom: 8 }} />,
                }}
                itemContent={(_i, p) => {
                  const ins = p.insuranceAmount || 0;
                  const net = Math.round((p.amount - ins) * 100) / 100;
                  return (
                  <div key={p.id} className="flex items-start justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="font-semibold text-gray-900">{fmtMoney(p.amount, p.currency)}</span>
                        {ins > 0 && (
                          <span className="text-xs text-indigo-700">{t('accounting.staff.minus_insurance', { amount: fmtMoney(ins, p.currency) })}{p.insurancePercentage !== null && p.insurancePercentage !== undefined ? ` (${p.insurancePercentage}%)` : ''}</span>
                        )}
                        {ins > 0 && (
                          <span className="text-xs font-semibold text-emerald-700">{t('accounting.staff.net_inline', { amount: fmtMoney(net, p.currency) })}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {t('accounting.staff.paid_on', { date: p.paidOn })}
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
                }}
              />
              {historyLoadingMore && <div className="py-2 text-center text-xs text-gray-400">{t('accounting.staff.loading_more')}</div>}
              {(() => {
                // Whole-set totals from the backend — reflects ALL payments,
                // not just the loaded page. Matches prior behavior: only the
                // staff member's own currency, hidden when no insurance.
                const tot = historyTotals.find(x => x.currency === historyTarget.currency);
                if (!tot || tot.count === 0 || tot.insurance === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-gray-500">{t('accounting.staff.total_gross')}</div>
                      <div className="font-semibold text-gray-900">{fmtMoney(tot.gross, historyTarget.currency)}</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-indigo-600">{t('accounting.staff.insurance_withheld')}</div>
                      <div className="font-semibold text-indigo-900">{fmtMoney(tot.insurance, historyTarget.currency)}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg py-2 px-3">
                      <div className="text-xs text-emerald-700">{t('accounting.staff.total_net')}</div>
                      <div className="font-semibold text-emerald-900">{fmtMoney(tot.net, historyTarget.currency)}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </Modal>
      )}

      {insurancePayoutTarget && insurancePayoutForm && (
        <Modal isOpen onClose={() => { setInsurancePayoutTarget(null); setInsurancePayoutForm(null); }} title={t('accounting.staff.pay_insurance_title', { name: insurancePayoutTarget.fullName })} size="lg">
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <div className="text-xs text-indigo-700 font-semibold uppercase tracking-wide">{t('accounting.staff.insurance_held')}</div>
              <div className="text-xl font-bold text-indigo-900 mt-1">{fmtMoney(insurancePayoutTarget.insuranceHeldTotal || 0, insurancePayoutTarget.currency)}</div>
              <div className="text-xs text-indigo-700 mt-1">{t('accounting.staff.total_withheld_hint')}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounting.staff.payout_amount')} type="number" step="0.01" min="0" value={insurancePayoutForm.amount} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, amount: e.target.value })} />
              <Input label={t('accounting.staff.currency')} value={insurancePayoutForm.currency} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, currency: e.target.value.toUpperCase() })} />
            </div>
            <Input label={t('accounting.staff.payout_date')} type="date" value={insurancePayoutForm.paidOn} onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, paidOn: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.staff.notes_optional')}</label>
              <textarea
                value={insurancePayoutForm.notes}
                onChange={e => setInsurancePayoutForm({ ...insurancePayoutForm, notes: e.target.value })}
                rows={3}
                placeholder={t('accounting.staff.ph_insurance_settlement')}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <p className="text-xs text-gray-500">{t('accounting.staff.insurance_settlement_hint')}</p>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => { setInsurancePayoutTarget(null); setInsurancePayoutForm(null); }}>{t('common.cancel')}</Button>
              <Button onClick={submitInsurancePayout} loading={savingInsurancePayout}>{t('accounting.staff.mark_insurance_paid')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {bulkNextPayment && (
        <Modal isOpen onClose={() => setBulkNextPayment(null)} title={t('accounting.staff.bulk_title')} size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t('accounting.staff.bulk_hint')}</p>

            <Input
              label={t('accounting.staff.next_payment_date')}
              type="date"
              value={bulkNextPayment.date}
              onChange={e => setBulkNextPayment({ ...bulkNextPayment, date: e.target.value })}
            />

            {!bulkNextPayment.date && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {t('accounting.staff.bulk_empty_warning')}
              </p>
            )}

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">
                  {t('accounting.staff.selected_count', { selected: bulkNextPayment.selectedIds.size, total: active?.length ?? 0 })}
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
                  {bulkNextPayment.selectedIds.size === (active?.length ?? 0) && (active?.length ?? 0) > 0 ? t('accounting.staff.deselect_all') : t('accounting.staff.select_all')}
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
                          {s.position ?? t('accounting.staff.staff_fallback')}
                          {s.nextPaymentDate ? <> · {t('accounting.staff.current_date', { date: s.nextPaymentDate })}</> : <> · {t('accounting.staff.no_date_set')}</>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setBulkNextPayment(null)}>{t('common.cancel')}</Button>
              <Button onClick={submitBulkNextPayment} loading={savingBulkNext} disabled={bulkNextPayment.selectedIds.size === 0}>
                {bulkNextPayment.date ? t('accounting.staff.apply_to', { count: bulkNextPayment.selectedIds.size }) : t('accounting.staff.clear_for', { count: bulkNextPayment.selectedIds.size })}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {massReminder && (
        <Modal isOpen onClose={() => setMassReminder(null)} title={t('accounting.staff.mass_title')} size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t('accounting.staff.mass_hint')}</p>

            <Input label={t('accounting.staff.custom_title')} value={massReminder.title} onChange={e => setMassReminder({ ...massReminder, title: e.target.value })} placeholder={t('accounting.staff.ph_salary_due')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.staff.custom_message')}</label>
              <textarea
                value={massReminder.message}
                onChange={e => setMassReminder({ ...massReminder, message: e.target.value })}
                rows={3}
                placeholder={t('accounting.staff.ph_custom_message')}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={massReminder.onlyDueSoon} onChange={e => setMassReminder({ ...massReminder, onlyDueSoon: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              {t('accounting.staff.only_due_within')}
            </label>
            {massReminder.onlyDueSoon && (
              <div className="flex items-center gap-2 ml-6">
                <Input label="" type="number" min="0" value={massReminder.dueWithinDays} onChange={e => setMassReminder({ ...massReminder, dueWithinDays: e.target.value })} />
                <span className="text-sm text-gray-500">{t('accounting.staff.days')}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setMassReminder(null)}>{t('common.cancel')}</Button>
              <Button onClick={sendMassReminder} loading={sendingMass}>{t('accounting.staff.send_reminders')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
