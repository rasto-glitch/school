import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { toast } from 'react-toastify';
import { Plus, RotateCcw, Edit2, Trash2, Tag, Repeat, Receipt, Archive, Calendar, History as HistoryIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { expensesApi, accountingApi, drainPages, type ExpenseCategory, type ExpenseTemplate, type ExpenseRow, type PaymentAccount } from '../../services/api';
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
  const { t } = useTranslation();
  const { school, user } = useAuthStore();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;
  const [tab, setTab] = useState<Tab>('recurring');

  if (!isPremium) {
    return (
      <PageLayout title={t('accounting.exp.title')} subtitle={t('accounting.premium_subtitle')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">{t('accounting.tuition.not_enabled_title')}</h3>
          <p className="text-sm text-amber-800">
            {t('accounting.tuition.not_enabled_body')}
          </p>
        </div>
      </PageLayout>
    );
  }
  if (!canWrite) {
    return (
      <PageLayout title={t('accounting.exp.title')} subtitle={t('accounting.tuition.restricted')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">{t('accounting.exp.no_access')}</p>
        </div>
      </PageLayout>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'recurring', label: t('accounting.exp.tab_recurring'), icon: Repeat },
    { id: 'one_time', label: t('accounting.exp.tab_one_time'), icon: Receipt },
    { id: 'categories', label: t('accounting.exp.tab_categories'), icon: Tag },
    { id: 'voided', label: t('accounting.exp.tab_voided'), icon: Archive },
  ];

  return (
    <PageLayout title={t('accounting.exp.title')} subtitle={t('accounting.exp.subtitle')}>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6 overflow-x-auto">
        {tabs.map(tabItem => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
              tab === tabItem.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tabItem.icon className="w-4 h-4" /> {tabItem.label}
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
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ExpenseTemplate[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseTemplate | null>(null);
  const [recording, setRecording] = useState<ExpenseTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [tpls, c] = await Promise.all([expensesApi.listTemplates(), expensesApi.listCategories()]);
      setTemplates(tpls.data);
      setCategories(c.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.load_failed_recurring'));
      setTemplates([]);
    }
  };
  useEffect(() => { reload(); }, []);

  const archive = async (tpl: ExpenseTemplate) => {
    if (!confirm(t('accounting.exp.confirm_archive_tpl', { name: tpl.name }))) return;
    setBusyId(tpl.id);
    try {
      await expensesApi.updateTemplate(tpl.id, { isActive: false });
      toast.success(t('accounting.exp.tpl_archived'));
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.failed_archive'));
    } finally { setBusyId(null); }
  };

  const restore = async (tpl: ExpenseTemplate) => {
    setBusyId(tpl.id);
    try {
      await expensesApi.updateTemplate(tpl.id, { isActive: true });
      toast.success(t('accounting.exp.tpl_restored'));
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.failed_restore'));
    } finally { setBusyId(null); }
  };

  const remove = async (tpl: ExpenseTemplate) => {
    if (!confirm(t('accounting.exp.confirm_delete_tpl', { name: tpl.name }))) return;
    setBusyId(tpl.id);
    try {
      await expensesApi.deleteTemplate(tpl.id);
      toast.success(t('accounting.exp.tpl_deleted'));
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.failed_delete'));
    } finally { setBusyId(null); }
  };

  if (templates === null) return <LoadingSpinner />;
  const active = templates.filter(tpl => tpl.isActive);
  const archived = templates.filter(tpl => !tpl.isActive);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          <Trans i18nKey="accounting.exp.recurring_hint" components={{ b: <span className="font-medium" /> }} />
        </p>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} icon={<Plus className="w-4 h-4" />} size="sm">
          {t('accounting.exp.new_template')}
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
          title={t('accounting.exp.recurring_empty_title')}
          description={t('accounting.exp.recurring_empty_desc')}
          icon={<Repeat className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2 mb-6">
              {active.map(tpl => (
                <Card key={tpl.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{tpl.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{t(`accounting.exp.cadence_${tpl.cadence}`)}</span>
                        {tpl.category && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{tpl.category.name}</span>}
                      </div>
                      <div className="text-sm text-gray-700 mt-1">
                        <span className="font-medium">{fmt(tpl.amount, tpl.currency)}</span>
                        {tpl.vendor && <span className="text-gray-500"> · {tpl.vendor}</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {tpl.nextDueDate ? <>{t('accounting.exp.next_due')}: <span className="font-medium text-gray-700">{tpl.nextDueDate}</span></> : t('accounting.exp.no_next_due')}
                      </div>
                      {tpl.notes && <div className="text-xs text-gray-500 mt-1 italic">{tpl.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" onClick={() => setRecording(tpl)} disabled={busyId === tpl.id}>{t('accounting.exp.record')}</Button>
                      <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditing(tpl); setShowForm(true); }} disabled={busyId === tpl.id}>{t('common.edit')}</Button>
                      <Button size="sm" variant="ghost" icon={<Archive className="w-4 h-4" />} onClick={() => archive(tpl)} disabled={busyId === tpl.id}>{t('accounting.exp.archive')}</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <details className="mt-4">
              <summary className="text-sm font-medium text-gray-700 cursor-pointer mb-2">{t('accounting.exp.archived_templates', { count: archived.length })}</summary>
              <div className="space-y-2">
                {archived.map(tpl => (
                  <Card key={tpl.id} className="opacity-70">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{tpl.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{t(`accounting.exp.cadence_${tpl.cadence}`)}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{t('accounting.exp.archived_badge')}</span>
                        </div>
                        <div className="text-sm text-gray-700 mt-1">{fmt(tpl.amount, tpl.currency)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="w-4 h-4" />} onClick={() => restore(tpl)} disabled={busyId === tpl.id}>{t('accounting.exp.restore')}</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => remove(tpl)} disabled={busyId === tpl.id}>{t('accounting.exp.delete')}</Button>
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
  const { t } = useTranslation();
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
    if (!name.trim()) { toast.error(t('accounting.exp.err_name_required')); return; }
    if (!isFinite(amt) || amt < 0) { toast.error(t('accounting.exp.err_amount')); return; }
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
      toast.success(isEdit ? t('accounting.exp.tpl_updated') : t('accounting.exp.tpl_added'));
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.failed_save'));
    } finally { setSubmitting(false); }
  };

  const activeCats = categories.filter(c => c.isActive);
  return (
    <Card className="mb-4 border-primary-200">
      <h3 className="font-semibold text-gray-900 mb-3">{isEdit ? t('accounting.exp.edit_template') : t('accounting.exp.new_recurring_template')}</h3>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label={t('accounting.exp.f_name')} value={name} onChange={e => setName(e.target.value)} placeholder={t('accounting.exp.ph_office_rent')} required />
        <Select
          label={t('accounting.exp.f_category')}
          options={activeCats.map(c => ({ value: c.id, label: c.name }))}
          placeholder={t('accounting.exp.uncategorized')}
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        />
        <Input label={t('accounting.exp.f_amount')} type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label={t('accounting.exp.f_currency')} value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD" />
        <Select
          label={t('accounting.exp.f_cadence')}
          options={[
            { value: 'monthly', label: t('accounting.exp.cadence_monthly') },
            { value: 'quarterly', label: t('accounting.exp.cadence_quarterly') },
            { value: 'yearly', label: t('accounting.exp.cadence_yearly') },
          ]}
          value={cadence}
          onChange={e => setCadence(e.target.value as 'monthly' | 'quarterly' | 'yearly')}
        />
        <Input label={t('accounting.exp.f_next_due')} type="date" value={nextDueDate} onChange={e => setNextDueDate(e.target.value)} />
        <Input label={t('accounting.exp.f_vendor')} value={vendor} onChange={e => setVendor(e.target.value)} placeholder={t('accounting.exp.ph_optional')} />
        <Input label={t('accounting.exp.f_notes')} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('accounting.exp.ph_optional')} />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={submitting}>{isEdit ? t('accounting.exp.save_changes') : t('accounting.exp.create_template')}</Button>
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
  const { t } = useTranslation();
  const [date, setDate] = useState(template.nextDueDate || todayISO());
  const [amount, setAmount] = useState(template.amount.toString());
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [taxLabel, setTaxLabel] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState<string>('');
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    accountingApi.listPaymentAccounts().then(r => {
      const active = r.data.filter(a => a.isActive);
      setAccounts(active);
      setPaymentAccountId(prev => prev || active[0]?.id || '');
    }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentAccountId) { toast.error(t('accounting.exp.err_choose_account')); return; }
    setSubmitting(true);
    try {
      const r = await expensesApi.recordTemplate(template.id, {
        expenseDate: date,
        amount: parseFloat(amount) || template.amount,
        paymentMethod: paymentMethod.trim() || null,
        notes: notes.trim() || null,
        taxAmount: Number(taxAmount) || 0,
        taxLabel: taxLabel.trim() || null,
        paymentAccountId,
      });
      toast.success(t('accounting.exp.recorded_next_due', { date: r.data.nextDueDate }));
      onRecorded();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.failed_record'));
    } finally { setSubmitting(false); }
  };

  return (
    <Card className="mb-4 border-blue-200 bg-blue-50/30">
      <h3 className="font-semibold text-gray-900 mb-1">{t('accounting.exp.record_title', { name: template.name })}</h3>
      <p className="text-xs text-gray-600 mb-3">
        {t('accounting.exp.record_hint', { period: t(`accounting.exp.bump_${template.cadence}`) })}
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label={t('accounting.exp.f_expense_date')} type="date" value={date} onChange={e => setDate(e.target.value)} required />
        <Input label={t('accounting.exp.f_amount')} type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label={t('accounting.exp.f_payment_method')} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder={t('accounting.exp.ph_payment_method')} />
        <Select
          label={t('accounting.exp.f_paid_from')}
          options={accounts.map(a => ({ value: a.id, label: `${a.name} (${a.kind} · ${a.currency})` }))}
          placeholder={accounts.length ? undefined : t('accounting.exp.ph_add_account_first')}
          value={paymentAccountId}
          onChange={e => setPaymentAccountId(e.target.value)}
        />
        <Input label={t('accounting.exp.f_tax')} type="number" step="0.01" min="0" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} placeholder="0.00" />
        <Input label={t('accounting.exp.f_tax_label')} value={taxLabel} onChange={e => setTaxLabel(e.target.value)} placeholder={t('accounting.exp.ph_tax_label')} />
        <Input label={t('accounting.exp.f_notes')} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('accounting.exp.ph_optional')} />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={submitting} disabled={!paymentAccountId}>{t('accounting.exp.record_expense')}</Button>
        </div>
      </form>
    </Card>
  );
}

// ── ONE-TIME TAB ────────────────────────────────────────────────────────
function OneTimeTab() {
  const { t } = useTranslation();
  // Rows are keyset-paginated and accumulate across pages. `totals`/`count`
  // are whole-set figures the backend computes over the full filtered set —
  // they never change as you scroll. Filters reload from the first page.
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [totals, setTotals] = useState<{ currency: string; total: number }[]>([]);
  const [count, setCount] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [filters, setFilters] = useState<{ startDate: string; endDate: string; categoryId: string; kind: 'all' | 'recurring' | 'one_time' }>({
    startDate: '', endDate: '', categoryId: '', kind: 'all',
  });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    if (cursor === null) { setExpenses(null); cursorRef.current = null; setHasMore(false); }
    else if (loadingMore || !cursorRef.current) return;
    const myReq = ++reqIdRef.current;
    if (cursor !== null) setLoadingMore(true);
    try {
      const [e, c] = await Promise.all([
        expensesApi.list({
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          categoryId: filters.categoryId || undefined,
          kind: filters.kind === 'all' ? undefined : filters.kind,
          cursor: cursor || undefined,
        }),
        cursor === null ? expensesApi.listCategories() : Promise.resolve(null),
      ]);
      if (myReq !== reqIdRef.current) return; // superseded by a newer reload
      cursorRef.current = e.data.nextCursor;
      setHasMore(!!e.data.nextCursor);
      setExpenses(prev => (cursor === null || !prev ? e.data.data : [...prev, ...e.data.data]));
      if (cursor === null) {
        setTotals(e.data.totals);
        setCount(e.data.count);
        if (c) setCategories(c.data);
      }
    } catch (err: any) {
      if (myReq === reqIdRef.current && cursor === null) {
        toast.error(err.response?.data?.error || t('accounting.exp.load_failed'));
        setExpenses([]);
      }
    } finally {
      if (cursor !== null) setLoadingMore(false);
    }
  }, [filters.startDate, filters.endDate, filters.categoryId, filters.kind, loadingMore]);

  const reload = useCallback(() => load(null), [load]);
  const loadMore = useCallback(() => { if (cursorRef.current) load(cursorRef.current); }, [load]);
  useEffect(() => { load(null); }, [filters.startDate, filters.endDate, filters.categoryId, filters.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const voidExpense = async (e: ExpenseRow) => {
    const reason = prompt(t('accounting.exp.void_reason_prompt')) ?? undefined;
    if (reason === undefined) return;
    setBusyId(e.id);
    try {
      await expensesApi.void(e.id, reason || undefined);
      toast.success(t('accounting.exp.expense_voided'));
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_void'));
    } finally { setBusyId(null); }
  };

  if (expenses === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-gray-600">{t('accounting.exp.onetime_hint')}</p>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} icon={<Plus className="w-4 h-4" />} size="sm">
          {t('accounting.exp.new_expense')}
        </Button>
      </div>

      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label={t('accounting.ledger.from')} type="date" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} />
          <Input label={t('accounting.ledger.to')} type="date" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} />
          <Select
            label={t('accounting.exp.f_category')}
            options={[{ value: '', label: t('accounting.tuition.all') }, ...categories.filter(c => c.isActive).map(c => ({ value: c.id, label: c.name }))]}
            value={filters.categoryId}
            onChange={e => setFilters(f => ({ ...f, categoryId: e.target.value }))}
          />
          <Select
            label={t('accounting.exp.f_type')}
            options={[
              { value: 'all', label: t('accounting.tuition.all') },
              { value: 'recurring', label: t('accounting.exp.filter_from_recurring') },
              { value: 'one_time', label: t('accounting.exp.filter_one_time_only') },
            ]}
            value={filters.kind}
            onChange={e => setFilters(f => ({ ...f, kind: e.target.value as any }))}
          />
        </div>
        {totals.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-3 text-sm">
            <span className="text-gray-500">{t('accounting.exp.total_count', { count })}:</span>
            {totals.map(tot => (
              <span key={tot.currency} className="font-semibold text-gray-900">{fmt(tot.total, tot.currency)}</span>
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
          title={t('accounting.exp.onetime_empty_title')}
          description={t('accounting.exp.onetime_empty_desc')}
          icon={<Receipt className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <div>
          <Virtuoso
            useWindowScroll
            data={expenses}
            increaseViewportBy={600}
            // Seamless background load — fires before the user hits bottom.
            endReached={() => loadMore()}
            components={{
              // 8px gap between cards, matching the prior `space-y-2`.
              Item: (props) => <div {...props} style={{ ...props.style, paddingBottom: 8 }} />,
            }}
            itemContent={(_i, e) => (
            <Card key={e.id}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{e.name}</span>
                    <span className="text-sm font-medium text-gray-700">{fmt(e.amount, e.currency)}</span>
                    {e.template && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 flex items-center gap-1"><Repeat className="w-3 h-3" /> {t(`accounting.exp.cadence_${e.template.cadence}`)}</span>}
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
                    <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditing(e); setShowForm(true); }} disabled={busyId === e.id}>{t('common.edit')}</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => voidExpense(e)} disabled={busyId === e.id}>{t('accounting.exp.void')}</Button>
                </div>
              </div>
            </Card>
            )}
          />
          {(loadingMore || hasMore) && (
            <div className="py-3 text-center text-xs text-gray-400">{loadingMore ? t('accounting.exp.loading_more') : ''}</div>
          )}
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
  const { t } = useTranslation();
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
    accountingApi.listPaymentAccounts().then(r => {
      const active = r.data.filter(a => a.isActive);
      setAccounts(active);
      setPaymentAccountId(prev => prev || active[0]?.id || '');
    }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!name.trim()) { toast.error(t('accounting.exp.err_name_required')); return; }
    if (!isFinite(amt) || amt < 0) { toast.error(t('accounting.exp.err_amount')); return; }
    if (!paymentAccountId) { toast.error(t('accounting.exp.err_choose_account')); return; }
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
      paymentAccountId,
    };
    try {
      if (isEdit) await expensesApi.update(expense!.id, payload);
      else await expensesApi.create(payload);
      toast.success(isEdit ? t('accounting.exp.expense_updated') : t('accounting.exp.expense_recorded'));
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_save'));
    } finally { setSubmitting(false); }
  };

  const activeCats = categories.filter(c => c.isActive);
  return (
    <Card className="mb-4 border-primary-200">
      <h3 className="font-semibold text-gray-900 mb-3">{isEdit ? t('accounting.exp.edit_expense') : t('accounting.exp.new_expense')}</h3>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label={t('accounting.exp.f_what')} value={name} onChange={e => setName(e.target.value)} placeholder={t('accounting.exp.ph_markers')} required />
        <Select
          label={t('accounting.exp.f_category')}
          options={activeCats.map(c => ({ value: c.id, label: c.name }))}
          placeholder={t('accounting.exp.uncategorized')}
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        />
        <Input label={t('accounting.exp.f_amount')} type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input label={t('accounting.exp.f_currency')} value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD" />
        <Input label={t('accounting.exp.f_date')} type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} required />
        <Input label={t('accounting.exp.f_vendor')} value={vendor} onChange={e => setVendor(e.target.value)} placeholder={t('accounting.exp.ph_optional')} />
        <Input label={t('accounting.exp.f_payment_method')} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder={t('accounting.exp.ph_payment_method2')} />
        <Select
          label={t('accounting.exp.f_paid_from')}
          options={accounts.map(a => ({ value: a.id, label: `${a.name} (${a.kind} · ${a.currency})` }))}
          placeholder={accounts.length ? undefined : t('accounting.exp.ph_add_account_first')}
          value={paymentAccountId}
          onChange={e => setPaymentAccountId(e.target.value)}
        />
        <Input label={t('accounting.exp.f_tax')} type="number" step="0.01" min="0" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} placeholder="0.00" />
        <Input label={t('accounting.exp.f_tax_label')} value={taxLabel} onChange={e => setTaxLabel(e.target.value)} placeholder={t('accounting.exp.ph_tax_label')} />
        <Input label={t('accounting.exp.f_notes')} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('accounting.exp.ph_optional')} />
        <div className="md:col-span-2 flex gap-2 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={submitting} disabled={!paymentAccountId}>{isEdit ? t('accounting.exp.save_changes') : t('accounting.exp.record_expense')}</Button>
        </div>
      </form>
    </Card>
  );
}

// ── CATEGORIES TAB ──────────────────────────────────────────────────────
function CategoriesTab() {
  const { t } = useTranslation();
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
      toast.error(e.response?.data?.error || t('accounting.exp.load_failed_cats'));
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
      toast.success(t('accounting.exp.cat_added'));
      setNewName('');
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_add'));
    } finally { setBusyId(null); }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setBusyId(id);
    try {
      await expensesApi.updateCategory(id, { name: editName.trim() });
      toast.success(t('accounting.exp.cat_renamed'));
      setEditingId(null);
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_save'));
    } finally { setBusyId(null); }
  };

  const toggleActive = async (c: ExpenseCategory) => {
    setBusyId(c.id);
    try {
      await expensesApi.updateCategory(c.id, { isActive: !c.isActive });
      toast.success(c.isActive ? t('accounting.exp.cat_archived') : t('accounting.exp.cat_restored'));
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_update'));
    } finally { setBusyId(null); }
  };

  const remove = async (c: ExpenseCategory) => {
    if (!confirm(t('accounting.exp.confirm_delete_cat', { name: c.name }))) return;
    setBusyId(c.id);
    try {
      await expensesApi.deleteCategory(c.id);
      toast.success(t('accounting.exp.cat_deleted'));
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_delete'));
    } finally { setBusyId(null); }
  };

  if (categories === null) return <LoadingSpinner />;
  const active = categories.filter(c => c.isActive);
  const archived = categories.filter(c => !c.isActive);

  return (
    <div>
      <Card className="mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">{t('accounting.exp.add_category')}</h3>
        <form onSubmit={create} className="flex gap-2 flex-wrap">
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('accounting.exp.ph_utilities')} className="min-w-[200px]" />
          <Button type="submit" loading={busyId === 'new'} icon={<Plus className="w-4 h-4" />}>{t('accounting.exp.add')}</Button>
        </form>
        <p className="text-xs text-gray-500 mt-2">{t('accounting.exp.cats_hint')}</p>
      </Card>

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title={t('accounting.exp.cats_empty_title')}
          description={t('accounting.exp.cats_empty_desc')}
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
                        <Button size="sm" onClick={() => saveEdit(c.id)} loading={busyId === c.id}>{t('common.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t('common.cancel')}</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => { setEditingId(c.id); setEditName(c.name); }}>{t('accounting.exp.rename')}</Button>
                        <Button size="sm" variant="ghost" icon={<Archive className="w-4 h-4" />} onClick={() => toggleActive(c)} disabled={busyId === c.id}>{t('accounting.exp.archive')}</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {archived.length > 0 && (
            <details>
              <summary className="text-sm font-medium text-gray-700 cursor-pointer mb-2">{t('accounting.exp.archived_count', { count: archived.length })}</summary>
              <div className="space-y-2">
                {archived.map(c => (
                  <Card key={c.id} className="opacity-70">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-gray-700">{c.name}</span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="w-4 h-4" />} onClick={() => toggleActive(c)} disabled={busyId === c.id}>{t('accounting.exp.restore')}</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={() => remove(c)} disabled={busyId === c.id}>{t('accounting.exp.delete')}</Button>
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
  const { t } = useTranslation();
  const [list, setList] = useState<(ExpenseRow & { voidedByName: string | null })[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const all = await drainPages<ExpenseRow & { voidedByName: string | null }>(c => expensesApi.listVoided(c));
      setList(all);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.exp.load_failed_voided'));
      setList([]);
    }
  };
  useEffect(() => { reload(); }, []);

  const restore = async (e: ExpenseRow) => {
    if (!confirm(t('accounting.exp.confirm_restore_expense'))) return;
    setBusyId(e.id);
    try {
      await expensesApi.unvoid(e.id);
      toast.success(t('accounting.exp.expense_restored'));
      await reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('accounting.exp.failed_restore'));
    } finally { setBusyId(null); }
  };

  if (list === null) return <LoadingSpinner />;
  if (list.length === 0) {
    return (
      <EmptyState
        title={t('accounting.exp.voided_empty_title')}
        description={t('accounting.exp.voided_empty_desc')}
        icon={<HistoryIcon className="w-8 h-8 text-gray-400" />}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-600 mb-2">{t('accounting.exp.voided_hint')}</div>
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
                {t('accounting.exp.voided_at', { date: formatDateTime(e.voidedAt) })}
                {e.voidedByName && <> {t('accounting.exp.by')} <span className="font-medium text-gray-700">{e.voidedByName}</span></>}
              </div>
              {e.voidReason && <div className="text-xs text-rose-700 italic mt-1">"{e.voidReason}"</div>}
            </div>
            <Button size="sm" variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={() => restore(e)} disabled={busyId === e.id}>{t('accounting.exp.restore')}</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
