import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, RotateCcw, Edit2, Trash2, Tag, Repeat, Receipt, Archive, Calendar, History as HistoryIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { expensesApi, accountingApi, type ExpenseCategory, type ExpenseTemplate, type ExpenseRow, type PaymentAccount } from '../../services/api';
import { fmtMoney as fmt } from '../../utils/money';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

type Tab = 'recurring' | 'one_time' | 'categories' | 'voided';

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const { school, user } = useAuthStore();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;
  const [tab, setTab] = useState<Tab>('recurring');

  if (!isPremium) {
    return (
      <PageLayout title="Expenses" subtitle="Premium feature">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">Accounting module not enabled</h3>
          <p className="text-sm text-amber-800">
            The accounting module is part of the Premium plan. Contact Scholify to enable it for your school.
          </p>
        </div>
      </PageLayout>
    );
  }
  if (!canWrite) {
    return (
      <PageLayout title="Expenses" subtitle="Restricted">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">You do not have access to expenses.</p>
        </div>
      </PageLayout>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'recurring', label: 'Recurring', icon: Repeat },
    { id: 'one_time', label: 'One-time', icon: Receipt },
    { id: 'categories', label: 'Categories', icon: Tag },
    { id: 'voided', label: 'Voided', icon: Archive },
  ];

  return (
    <PageLayout title="Expenses" subtitle="Track operating expenses, recurring or one-time">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'recurring' && <RecurringTab />}
      {tab === 'one_time' && <OneTimeTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'voided' && <VoidedTab />}
    </PageLayout>
  );
}

// ── RECURRING TAB ───────────────────────────────────────────────────────
function RecurringTab() {
  const [templates, setTemplates] = useState<ExpenseTemplate[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseTemplate | null>(null);
  const [recording, setRecording] = useState<ExpenseTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [t, c] = await Promise.all([expensesApi.listTemplates(), expensesApi.listCategories()]);
      setTemplates(t.data);
      setCategories(c.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load recurring expenses');
      setTemplates([]);
    }
  };
  useEffect(() => { reload(); }, []);

  const archive = async (t: ExpenseTemplate) => {
    if (!confirm(`Archive "${t.name}"? It will stop appearing in the list but past expenses are kept.`)) return;
    setBusyId(t.id);
    try {
      await expensesApi.updateTemplate(t.id, { isActive: false });
      toast.success('Template archived');
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to archive');
    } finally { setBusyId(null); }
  };

  const restore = async (t: ExpenseTemplate) => {
    setBusyId(t.id);
    try {
      await expensesApi.updateTemplate(t.id, { isActive: true });
      toast.success('Template restored');
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to restore');
    } finally { setBusyId(null); }
  };

  const remove = async (t: ExpenseTemplate) => {
    if (!confirm(`Permanently delete the template "${t.name}"? Past expenses recorded from it remain.`)) return;
    setBusyId(t.id);
    try {
      await expensesApi.deleteTemplate(t.id);
      toast.success('Template deleted');
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    } finally { setBusyId(null); }
  };

  if (templates === null) return <LoadingSpinner />;
  const active = templates.filter(t => t.isActive);
  const archived = templates.filter(t => !t.isActive);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          Recurring templates define repeating costs (rent, internet, etc.). Click <span className="font-medium">Record</span> each period to log the actual expense.
        </p>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} icon={<Plus className="w-4 h-4" />} size="sm">
          New template
        </Button>
      </div>

      {showForm && (
        <TemplateForm
          template={editing}
          categories={categories}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={async () => { setShowForm(false); setEditing(null); await reload(); }}
        />
      )}

      {recording && (
        <RecordTemplateForm
          template={recording}
          onClose={() => setRecording(null)}
          onRecorded={async () => { setRecording(null); await reload(); }}
        />
      )}

      {templates.length === 0 ? (
        <EmptyState
          title="No recurring expenses yet"
          description="Add a template for any cost that repeats — rent, utilities, internet, subscriptions."
          icon={<Repeat className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2 mb-6">
              {active.map(t => (
                <Card key={t.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{t.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 capitalize">{t.cadence}</span>
                        {t.category && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{t.category.name}</span>}
                      </div>
                      <div className="text-sm text-gray-700 mt-1">
                        <span className="font-medium">{fmt(t.amount, t.currency)}</span>
                        {t.vendor && <span className="text-gray-500"> · {t.vendor}</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {t.nextDueDate ? <>Next due: <span className="font-medium text-gray-700">{t.nextDueDate}</span></> : 'No next due date set'}
                      </div>
                      {t.notes && <div className="text-xs text-gray-500 mt-1 italic">{t.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" onClick={() => setRecording(t)} disabled={busyId === t.id}>Record</Button>
                      <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditing(t); setShowForm(true); }} disabled={busyId === t.id}>Edit</Button>
                      <Button size="sm" variant="ghost" icon={<Archive className="w-4 h-4" />} onClick={() => archive(t)} disabled={busyId === t.id}>Archive</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <details className="mt-4">
              <summary className="text-sm font-medium text-gray-700 cursor-pointer mb-2">Archived templates ({archived.length})</summary>
              <div className="space-y-2">
                {archived.map(t => (
                  <Card key={t.id} className="opacity-70">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{t.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 capitalize">{t.cadence}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Archived</span>
                        </div>
                        <div className="text-sm text-gray-700 mt-1">{fmt(t.amount, t.currency)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="w-4 h-4" />} onClick={() => restore(t)} disabled={busyId === t.id}>Restore</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => remove(t)} disabled={busyId === t.id}>Delete</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// Form for creating / editing a recurring template
function TemplateForm({ template, categories, onClose, onSaved }: {
  template: ExpenseTemplate | null;
  categories: ExpenseCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!template;
  const [name, setName] = useState(template?.name ?? '');
  const [amount, setAmount] = useState(template?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState(template?.currency ?? 'USD');
  const [cadence, setCadence] = useState<'monthly' | 'quarterly' | 'yearly'>(template?.cadence ?? 'monthly');
  const [nextDueDate, setNextDueDate] = useState(template?.nextDueDate ?? '');
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? '');
  const [vendor, setVendor] = useState(template?.vendor ?? '');
  const [notes, setNotes] = useState(template?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!isFinite(amt) || amt < 0) { toast.error('Amount must be a non-negative number'); return; }
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      amount: amt,
      currency: currency.trim() || 'USD',
      cadence,
      nextDueDate: nextDueDate || null,
      categoryId: categoryId || null,
      vendor: vendor.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      if (isEdit) await expensesApi.updateTemplate(template!.id, payload);
      else await expensesApi.createTemplate(payload);
      toast.success(isEdit ? 'Template updated' : 'Template added');
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const activeCats = categories.filter(c => c.isActive);
  return (
    <Card className="mb-4 border-primary-200">
      <h3 className="font-semibold text-gray-900 mb-3">{isEdit ? 'Edit template' : 'New recurring template'}</h3>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office rent" required />
        <Select
          label="Category"
          options={activeCats.map(c => ({ value: c.id, label: c.name }))}
          placeholder="(Uncategorized)"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        />
        <Input label="Amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label="Currency" value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD" />
        <Select
          label="Cadence"
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
          value={cadence}
          onChange={e => setCadence(e.target.value as 'monthly' | 'quarterly' | 'yearly')}
        />
        <Input label="Next due date" type="date" value={nextDueDate} onChange={e => setNextDueDate(e.target.value)} />
        <Input label="Vendor / payee" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="(optional)" />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="(optional)" />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>{isEdit ? 'Save changes' : 'Create template'}</Button>
        </div>
      </form>
    </Card>
  );
}

// Form for recording an expense from a template
function RecordTemplateForm({ template, onClose, onRecorded }: {
  template: ExpenseTemplate;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [date, setDate] = useState(template.nextDueDate || todayISO());
  const [amount, setAmount] = useState(template.amount.toString());
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await expensesApi.recordTemplate(template.id, {
        expenseDate: date,
        amount: parseFloat(amount) || template.amount,
        paymentMethod: paymentMethod.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(`Recorded. Next due: ${r.data.nextDueDate}`);
      onRecorded();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to record');
    } finally { setSubmitting(false); }
  };

  return (
    <Card className="mb-4 border-blue-200 bg-blue-50/30">
      <h3 className="font-semibold text-gray-900 mb-1">Record "{template.name}"</h3>
      <p className="text-xs text-gray-600 mb-3">
        Creates an expense entry and bumps next-due forward by {template.cadence === 'monthly' ? '1 month' : template.cadence === 'quarterly' ? '3 months' : '1 year'}.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Expense date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
        <Input label="Amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label="Payment method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="cash, bank transfer..." />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="(optional)" />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Record expense</Button>
        </div>
      </form>
    </Card>
  );
}

// ── ONE-TIME TAB ────────────────────────────────────────────────────────
function OneTimeTab() {
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [filters, setFilters] = useState<{ startDate: string; endDate: string; categoryId: string; kind: 'all' | 'recurring' | 'one_time' }>({
    startDate: '', endDate: '', categoryId: '', kind: 'all',
  });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [e, c] = await Promise.all([
        expensesApi.list({
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          categoryId: filters.categoryId || undefined,
          kind: filters.kind === 'all' ? undefined : filters.kind,
        }),
        expensesApi.listCategories(),
      ]);
      setExpenses(e.data);
      setCategories(c.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load expenses');
      setExpenses([]);
    }
  };
  useEffect(() => { reload(); }, [filters.startDate, filters.endDate, filters.categoryId, filters.kind]);

  const totals = useMemo(() => {
    if (!expenses) return [];
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.currency, (map.get(e.currency) ?? 0) + Number(e.amount || 0));
    return Array.from(map.entries()).map(([cur, t]) => ({ currency: cur, total: t }));
  }, [expenses]);

  const voidExpense = async (e: ExpenseRow) => {
    const reason = prompt('Reason for voiding (optional):') ?? undefined;
    if (reason === undefined) return;
    setBusyId(e.id);
    try {
      await expensesApi.void(e.id, reason || undefined);
      toast.success('Expense voided');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to void');
    } finally { setBusyId(null); }
  };

  if (expenses === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-gray-600">All recorded expenses, including those generated from recurring templates.</p>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} icon={<Plus className="w-4 h-4" />} size="sm">
          New expense
        </Button>
      </div>

      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="From" type="date" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} />
          <Input label="To" type="date" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} />
          <Select
            label="Category"
            options={[{ value: '', label: 'All' }, ...categories.filter(c => c.isActive).map(c => ({ value: c.id, label: c.name }))]}
            value={filters.categoryId}
            onChange={e => setFilters(f => ({ ...f, categoryId: e.target.value }))}
          />
          <Select
            label="Type"
            options={[
              { value: 'all', label: 'All' },
              { value: 'recurring', label: 'From recurring' },
              { value: 'one_time', label: 'One-time only' },
            ]}
            value={filters.kind}
            onChange={e => setFilters(f => ({ ...f, kind: e.target.value as any }))}
          />
        </div>
        {totals.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-3 text-sm">
            <span className="text-gray-500">Total ({expenses.length}):</span>
            {totals.map(t => (
              <span key={t.currency} className="font-semibold text-gray-900">{fmt(t.total, t.currency)}</span>
            ))}
          </div>
        )}
      </Card>

      {showForm && (
        <ExpenseForm
          expense={editing}
          categories={categories}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={async () => { setShowForm(false); setEditing(null); await reload(); }}
        />
      )}

      {expenses.length === 0 ? (
        <EmptyState
          title="No expenses match"
          description="Adjust the filters or add a new expense."
          icon={<Receipt className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <div className="space-y-2">
          {expenses.map(e => (
            <Card key={e.id}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{e.name}</span>
                    <span className="text-sm font-medium text-gray-700">{fmt(e.amount, e.currency)}</span>
                    {e.template && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 flex items-center gap-1"><Repeat className="w-3 h-3" /> {e.template.cadence}</span>}
                    {e.category && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{e.category.name}</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {e.expenseDate}
                    {e.vendor && <span> · {e.vendor}</span>}
                    {e.paymentMethod && <span> · {e.paymentMethod}</span>}
                  </div>
                  {e.notes && <div className="text-xs text-gray-600 mt-1 italic">{e.notes}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {!e.template && (
                    <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditing(e); setShowForm(true); }} disabled={busyId === e.id}>Edit</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => voidExpense(e)} disabled={busyId === e.id}>Void</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpenseForm({ expense, categories, onClose, onSaved }: {
  expense: ExpenseRow | null;
  categories: ExpenseCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!expense;
  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState(expense?.currency ?? 'USD');
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? todayISO());
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [vendor, setVendor] = useState(expense?.vendor ?? '');
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod ?? '');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [taxAmount, setTaxAmount] = useState(expense ? String((expense as any).taxAmount ?? '') : '');
  const [taxLabel, setTaxLabel] = useState((expense as any)?.taxLabel ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState<string>((expense as any)?.paymentAccountId ?? '');
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    accountingApi.listPaymentAccounts().then(r => setAccounts(r.data.filter(a => a.isActive))).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!isFinite(amt) || amt < 0) { toast.error('Amount must be a non-negative number'); return; }
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      amount: amt,
      currency: currency.trim() || 'USD',
      expenseDate,
      categoryId: categoryId || null,
      vendor: vendor.trim() || null,
      paymentMethod: paymentMethod.trim() || null,
      notes: notes.trim() || null,
      taxAmount: Number(taxAmount) || 0,
      taxLabel: taxLabel.trim() || null,
      paymentAccountId: paymentAccountId || null,
    };
    try {
      if (isEdit) await expensesApi.update(expense!.id, payload);
      else await expensesApi.create(payload);
      toast.success(isEdit ? 'Expense updated' : 'Expense recorded');
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const activeCats = categories.filter(c => c.isActive);
  return (
    <Card className="mb-4 border-primary-200">
      <h3 className="font-semibold text-gray-900 mb-3">{isEdit ? 'Edit expense' : 'New expense'}</h3>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="What" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Whiteboard markers" required />
        <Select
          label="Category"
          options={activeCats.map(c => ({ value: c.id, label: c.name }))}
          placeholder="(Uncategorized)"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        />
        <Input label="Amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label="Currency" value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD" />
        <Input label="Date" type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} required />
        <Input label="Vendor / payee" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="(optional)" />
        <Input label="Payment method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="cash, transfer, card..." />
        <Select
          label="Paid from (optional)"
          options={accounts.map(a => ({ value: a.id, label: `${a.name} (${a.kind} · ${a.currency})` }))}
          placeholder={accounts.length ? '— No specific account —' : '(Add payment accounts to track per-till balances)'}
          value={paymentAccountId}
          onChange={e => setPaymentAccountId(e.target.value)}
        />
        <Input label="Tax / VAT (optional)" type="number" step="0.01" min="0" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} placeholder="0.00" />
        <Input label="Tax label" value={taxLabel} onChange={e => setTaxLabel(e.target.value)} placeholder="VAT 5%, etc." />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="(optional)" />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>{isEdit ? 'Save changes' : 'Record expense'}</Button>
        </div>
      </form>
    </Card>
  );
}

// ── CATEGORIES TAB ──────────────────────────────────────────────────────
function CategoriesTab() {
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await expensesApi.listCategories();
      setCategories(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load categories');
      setCategories([]);
    }
  };
  useEffect(() => { reload(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusyId('new');
    try {
      await expensesApi.createCategory({ name: newName.trim() });
      toast.success('Category added');
      setNewName('');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add');
    } finally { setBusyId(null); }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setBusyId(id);
    try {
      await expensesApi.updateCategory(id, { name: editName.trim() });
      toast.success('Category renamed');
      setEditingId(null);
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setBusyId(null); }
  };

  const toggleActive = async (c: ExpenseCategory) => {
    setBusyId(c.id);
    try {
      await expensesApi.updateCategory(c.id, { isActive: !c.isActive });
      toast.success(c.isActive ? 'Category archived' : 'Category restored');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update');
    } finally { setBusyId(null); }
  };

  const remove = async (c: ExpenseCategory) => {
    if (!confirm(`Permanently delete "${c.name}"? This is only allowed if no expenses or templates reference it.`)) return;
    setBusyId(c.id);
    try {
      await expensesApi.deleteCategory(c.id);
      toast.success('Category deleted');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    } finally { setBusyId(null); }
  };

  if (categories === null) return <LoadingSpinner />;
  const active = categories.filter(c => c.isActive);
  const archived = categories.filter(c => !c.isActive);

  return (
    <div>
      <Card className="mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">Add category</h3>
        <form onSubmit={create} className="flex gap-2 flex-wrap">
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Utilities" className="min-w-[200px]" />
          <Button type="submit" loading={busyId === 'new'} icon={<Plus className="w-4 h-4" />}>Add</Button>
        </form>
        <p className="text-xs text-gray-500 mt-2">Categories shape your chart of accounts. Archived categories stay attached to historical expenses.</p>
      </Card>

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Add your first category above."
          icon={<Tag className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <>
          <div className="space-y-2 mb-6">
            {active.map(c => (
              <Card key={c.id}>
                <div className="flex items-center justify-between gap-3">
                  {editingId === c.id ? (
                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1" />
                  ) : (
                    <span className="font-medium text-gray-900">{c.name}</span>
                  )}
                  <div className="flex items-center gap-2">
                    {editingId === c.id ? (
                      <>
                        <Button size="sm" onClick={() => saveEdit(c.id)} loading={busyId === c.id}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditingId(c.id); setEditName(c.name); }}>Rename</Button>
                        <Button size="sm" variant="ghost" icon={<Archive className="w-4 h-4" />} onClick={() => toggleActive(c)} disabled={busyId === c.id}>Archive</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {archived.length > 0 && (
            <details>
              <summary className="text-sm font-medium text-gray-700 cursor-pointer mb-2">Archived ({archived.length})</summary>
              <div className="space-y-2">
                {archived.map(c => (
                  <Card key={c.id} className="opacity-70">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-gray-700">{c.name}</span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="w-4 h-4" />} onClick={() => toggleActive(c)} disabled={busyId === c.id}>Restore</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => remove(c)} disabled={busyId === c.id}>Delete</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ── VOIDED TAB ──────────────────────────────────────────────────────────
function VoidedTab() {
  const [list, setList] = useState<(ExpenseRow & { voidedByName: string | null })[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await expensesApi.listVoided();
      setList(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load voided expenses');
      setList([]);
    }
  };
  useEffect(() => { reload(); }, []);

  const restore = async (e: ExpenseRow) => {
    if (!confirm('Restore this expense? It will reappear in the ledger.')) return;
    setBusyId(e.id);
    try {
      await expensesApi.unvoid(e.id);
      toast.success('Expense restored');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to restore');
    } finally { setBusyId(null); }
  };

  if (list === null) return <LoadingSpinner />;
  if (list.length === 0) {
    return (
      <EmptyState
        title="Nothing voided"
        description="Voided expenses appear here for the recovery window before being permanently deleted."
        icon={<HistoryIcon className="w-8 h-8 text-gray-400" />}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-600 mb-2">Voided expenses are permanently deleted after 30 days. Restore to bring one back.</div>
      {list.map(e => (
        <Card key={e.id}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900">{e.name}</span>
                <span className="text-sm font-medium text-gray-700">{fmt(e.amount, e.currency)}</span>
                {e.category && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{e.category.name}</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1">{e.expenseDate}{e.vendor && <span> · {e.vendor}</span>}</div>
              <div className="text-xs text-gray-500 mt-1">
                Voided {formatDateTime(e.voidedAt)}
                {e.voidedByName && <> by <span className="font-medium text-gray-700">{e.voidedByName}</span></>}
              </div>
              {e.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{e.voidReason}"</div>}
            </div>
            <Button size="sm" variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={() => restore(e)} disabled={busyId === e.id}>Restore</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
