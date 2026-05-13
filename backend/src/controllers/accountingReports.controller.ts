import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';

// Report endpoints that aggregate across fee_payments, staff_salary_payments,
// expenses, fee_plans, and student_fees. All filter by school_id, exclude
// voided rows, and skip non-tuition fee plans where appropriate.

async function ensurePremium(schoolId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase.from('schools').select('features').eq('id', schoolId).single();
  if ((data?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    return { ok: false, status: 403, error: 'Accounting module is not enabled for this school.' };
  }
  return { ok: true };
}

async function getDefaultCurrency(schoolId: string): Promise<string> {
  const { data } = await supabase.from('schools').select('tuition_config').eq('id', schoolId).single();
  const cfg = (data?.tuition_config as { currency?: string } | null) ?? {};
  return cfg.currency ?? 'USD';
}

// Convert `amount` from `from` → `to` using the most recent fx_rate ≤ asOf
// (or `today` if asOf is omitted). Returns null when no rate is configured —
// the caller decides whether to report mixed currencies or skip.
async function convertAmount(schoolId: string, amount: number, from: string, to: string, asOf?: string): Promise<number | null> {
  if (from === to) return amount;
  const cutoff = asOf || new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('fx_rates')
    .select('rate')
    .eq('school_id', schoolId)
    .eq('from_currency', from)
    .eq('to_currency', to)
    .lte('effective_from', cutoff)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return Math.round(amount * Number(data.rate) * 100) / 100;
}

// ── DASHBOARD SUMMARY ───────────────────────────────────────────────────
// One-shot fetch for the accountant landing page: KPIs across this month
// + AR aging buckets + upcoming staff/expense obligations.
export async function getDashboardSummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const d = new Date();
  const firstOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const in7days = new Date(d.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const in30days = new Date(d.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const defaultCurrency = await getDefaultCurrency(schoolId);

  // This month's flow
  const [{ data: fpThis }, { data: sspThis }, { data: exThis }] = await Promise.all([
    supabase.from('fee_payments').select('amount, currency, is_refund').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', firstOfMonth).lte('paid_on', today),
    supabase.from('staff_salary_payments').select('amount, currency').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', firstOfMonth).lte('paid_on', today),
    supabase.from('expenses').select('amount, currency').eq('school_id', schoolId).is('voided_at', null).gte('expense_date', firstOfMonth).lte('expense_date', today),
  ]);

  // Per-currency totals so we don't silently mix currencies
  const byCurrency = new Map<string, { income: number; expense: number }>();
  const bump = (cur: string, kind: 'income' | 'expense', amt: number) => {
    const slot = byCurrency.get(cur) ?? { income: 0, expense: 0 };
    slot[kind] += amt;
    byCurrency.set(cur, slot);
  };
  for (const r of (fpThis ?? []) as any[]) bump(r.currency ?? defaultCurrency, r.is_refund ? 'expense' : 'income', Number(r.amount));
  for (const r of (sspThis ?? []) as any[]) bump(r.currency ?? defaultCurrency, 'expense', Number(r.amount));
  for (const r of (exThis ?? []) as any[]) bump(r.currency ?? defaultCurrency, 'expense', Number(r.amount));

  // Upcoming obligations: salaries due in 7 days, recurring expenses next due
  const [{ data: staffDue }, { data: recurringDue }] = await Promise.all([
    supabase.from('staff_members').select('id, full_name, salary_amount, currency, next_payment_date')
      .eq('school_id', schoolId).is('voided_at', null).eq('is_active', true)
      .not('next_payment_date', 'is', null).lte('next_payment_date', in7days).order('next_payment_date'),
    supabase.from('expense_recurring_templates').select('id, name, amount, currency, next_due_date')
      .eq('school_id', schoolId).eq('is_active', true)
      .not('next_due_date', 'is', null).lte('next_due_date', in30days).order('next_due_date'),
  ]);

  // Receivables: total balance from student_fees aggregate (simpler: sum due − sum paid)
  // We re-use a coarse calc here since fees.controller has the full logic; this dashboard
  // is for at-a-glance numbers only.
  const [{ data: sfs }, { data: pays }, { data: lateFees }] = await Promise.all([
    supabase.from('student_fees').select('id, total_amount, adjustment, fee_plans(currency, kind)').eq('school_id', schoolId),
    supabase.from('fee_payments').select('student_fee_id, amount, is_refund').eq('school_id', schoolId).is('voided_at', null),
    supabase.from('student_fee_late_fees').select('student_fee_id, amount').eq('school_id', schoolId).is('voided_at', null),
  ]);

  const paidBySf = new Map<string, number>();
  for (const p of (pays ?? []) as any[]) {
    const sign = p.is_refund ? -1 : 1;
    paidBySf.set(p.student_fee_id, (paidBySf.get(p.student_fee_id) ?? 0) + sign * Number(p.amount));
  }
  const lateBySf = new Map<string, number>();
  for (const lf of (lateFees ?? []) as any[]) {
    lateBySf.set(lf.student_fee_id, (lateBySf.get(lf.student_fee_id) ?? 0) + Number(lf.amount));
  }
  const arByCurrency = new Map<string, number>();
  let overdueCount = 0;
  for (const sf of (sfs ?? []) as any[]) {
    const cur = sf.fee_plans?.currency ?? defaultCurrency;
    const due = Number(sf.total_amount) + Number(sf.adjustment) + (lateBySf.get(sf.id) ?? 0);
    const paid = paidBySf.get(sf.id) ?? 0;
    const bal = due - paid;
    if (bal > 0.01) {
      arByCurrency.set(cur, (arByCurrency.get(cur) ?? 0) + bal);
      overdueCount += 1;
    }
  }

  res.json({
    defaultCurrency,
    period: { from: firstOfMonth, to: today },
    monthByCurrency: Array.from(byCurrency.entries()).map(([currency, v]) => ({ currency, income: Math.round(v.income * 100) / 100, expense: Math.round(v.expense * 100) / 100, net: Math.round((v.income - v.expense) * 100) / 100 })),
    arByCurrency: Array.from(arByCurrency.entries()).map(([currency, balance]) => ({ currency, balance: Math.round(balance * 100) / 100 })),
    arStudentCount: overdueCount,
    upcomingSalaries: (staffDue ?? []).map((s: any) => ({ id: s.id, fullName: s.full_name, amount: Number(s.salary_amount), currency: s.currency, nextPaymentDate: s.next_payment_date })),
    upcomingRecurringExpenses: (recurringDue ?? []).map((r: any) => ({ id: r.id, name: r.name, amount: Number(r.amount), currency: r.currency, nextDueDate: r.next_due_date })),
  });
}

// ── AR AGING REPORT ─────────────────────────────────────────────────────
// For every student with an outstanding balance, distribute that balance
// across age buckets (0-30 / 31-60 / 61-90 / 90+) based on the oldest
// overdue installment that isn't yet covered by payments.
export async function getArAging(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  const defaultCurrency = await getDefaultCurrency(schoolId);

  const [{ data: sfs }, { data: insts }, { data: pays }, { data: lateFees }] = await Promise.all([
    supabase.from('student_fees').select(`
      id, student_id, total_amount, adjustment, fee_plan_id,
      students!inner(id, full_name, parent_id, classes(name), parents(full_name)),
      fee_plans!inner(id, name, currency, kind)
    `).eq('school_id', schoolId),
    supabase.from('fee_installments').select('fee_plan_id, id, sequence, amount, due_date').eq('school_id', schoolId),
    supabase.from('fee_payments').select('student_fee_id, amount, is_refund').eq('school_id', schoolId).is('voided_at', null),
    supabase.from('student_fee_late_fees').select('student_fee_id, amount').eq('school_id', schoolId).is('voided_at', null),
  ]);

  const instByPlan = new Map<string, { sequence: number; amount: number; due_date: string }[]>();
  for (const i of (insts ?? []) as any[]) {
    const arr = instByPlan.get(i.fee_plan_id) ?? [];
    arr.push({ sequence: i.sequence, amount: Number(i.amount), due_date: i.due_date });
    instByPlan.set(i.fee_plan_id, arr);
  }
  const paidBySf = new Map<string, number>();
  for (const p of (pays ?? []) as any[]) {
    const sign = p.is_refund ? -1 : 1;
    paidBySf.set(p.student_fee_id, (paidBySf.get(p.student_fee_id) ?? 0) + sign * Number(p.amount));
  }
  const lateBySf = new Map<string, number>();
  for (const lf of (lateFees ?? []) as any[]) {
    lateBySf.set(lf.student_fee_id, (lateBySf.get(lf.student_fee_id) ?? 0) + Number(lf.amount));
  }

  interface Bucket { current: number; b1_30: number; b31_60: number; b61_90: number; b90_plus: number }
  const emptyBucket = (): Bucket => ({ current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 });
  const placeBucket = (b: Bucket, daysOverdue: number, amt: number) => {
    if (daysOverdue <= 0) b.current += amt;
    else if (daysOverdue <= 30) b.b1_30 += amt;
    else if (daysOverdue <= 60) b.b31_60 += amt;
    else if (daysOverdue <= 90) b.b61_90 += amt;
    else b.b90_plus += amt;
  };

  const rows: any[] = [];
  const totalsByCurrency = new Map<string, Bucket & { balance: number }>();

  for (const sf of (sfs ?? []) as any[]) {
    const cur = sf.fee_plans?.currency ?? defaultCurrency;
    const lateFee = lateBySf.get(sf.id) ?? 0;
    const dueTotal = Number(sf.total_amount) + Number(sf.adjustment) + lateFee;
    const paid = paidBySf.get(sf.id) ?? 0;
    const balance = Math.max(0, dueTotal - paid);
    if (balance < 0.01) continue;

    // Walk installments in order, consuming payments. Whatever's left in each
    // installment lands in a bucket based on (today − due_date).
    const installments = (instByPlan.get(sf.fee_plan_id) ?? []).sort((a, b) => a.sequence - b.sequence);
    const bucket = emptyBucket();
    let remainingPaid = paid;
    if (installments.length === 0) {
      // No schedule — treat as fully due today (current bucket)
      bucket.current += balance;
    } else {
      for (const inst of installments) {
        const unpaid = Math.max(0, inst.amount - remainingPaid);
        remainingPaid = Math.max(0, remainingPaid - inst.amount);
        if (unpaid < 0.01) continue;
        const daysOverdue = Math.round((todayMs - new Date(inst.due_date + 'T00:00:00Z').getTime()) / 86400000);
        placeBucket(bucket, daysOverdue, unpaid);
      }
      // Late-fee component lands in current bucket (it's an addition for today)
      if (lateFee > 0) bucket.current += lateFee;
    }

    rows.push({
      studentFeeId: sf.id,
      studentId: sf.student_id,
      studentName: sf.students?.full_name ?? '',
      className: sf.students?.classes?.name ?? null,
      parentName: sf.students?.parents?.full_name ?? null,
      planName: sf.fee_plans?.name ?? '',
      kind: sf.fee_plans?.kind ?? 'tuition',
      currency: cur,
      balance: Math.round(balance * 100) / 100,
      ...bucket,
    });

    const tot = totalsByCurrency.get(cur) ?? ({ ...emptyBucket(), balance: 0 } as Bucket & { balance: number });
    tot.balance += balance;
    tot.current += bucket.current;
    tot.b1_30 += bucket.b1_30;
    tot.b31_60 += bucket.b31_60;
    tot.b61_90 += bucket.b61_90;
    tot.b90_plus += bucket.b90_plus;
    totalsByCurrency.set(cur, tot);
  }

  rows.sort((a, b) => b.b90_plus - a.b90_plus || b.balance - a.balance);

  res.json({
    asOf: today,
    rows,
    totals: Array.from(totalsByCurrency.entries()).map(([currency, t]) => ({ currency, ...t })),
  });
}

// ── PROFIT & LOSS REPORT ────────────────────────────────────────────────
// Income vs expense bucketed by category for a date range. Optional prior-
// period compare returns the same shape for the equivalent prior window.
export async function getProfitLoss(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const startDate = (req.query.startDate as string | undefined) || '';
  const endDate = (req.query.endDate as string | undefined) || '';
  const compare = (req.query.compare as string | undefined) === '1';
  if (!startDate || !endDate) { res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' }); return; }

  const defaultCurrency = await getDefaultCurrency(schoolId);

  const buildOne = async (from: string, to: string) => {
    const [{ data: fp }, { data: ssp }, { data: ex }] = await Promise.all([
      supabase.from('fee_payments').select('amount, currency, is_refund, student_fees(fee_plans(kind))').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', from).lte('paid_on', to),
      supabase.from('staff_salary_payments').select('amount, currency').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', from).lte('paid_on', to),
      supabase.from('expenses').select('amount, currency, expense_categories(name)').eq('school_id', schoolId).is('voided_at', null).gte('expense_date', from).lte('expense_date', to),
    ]);
    const byCur = new Map<string, { income: Record<string, number>; expense: Record<string, number> }>();
    const ensure = (cur: string) => {
      const e = byCur.get(cur) ?? { income: {}, expense: {} };
      byCur.set(cur, e);
      return e;
    };
    for (const r of (fp ?? []) as any[]) {
      const cur = r.currency ?? defaultCurrency;
      const e = ensure(cur);
      const category = r.is_refund ? 'Refunds' : (r.student_fees?.fee_plans?.kind ?? 'tuition');
      const bucket = r.is_refund ? e.expense : e.income;
      bucket[category] = (bucket[category] ?? 0) + Number(r.amount);
    }
    for (const r of (ssp ?? []) as any[]) {
      const cur = r.currency ?? defaultCurrency;
      const e = ensure(cur);
      e.expense['Salary'] = (e.expense['Salary'] ?? 0) + Number(r.amount);
    }
    for (const r of (ex ?? []) as any[]) {
      const cur = r.currency ?? defaultCurrency;
      const e = ensure(cur);
      const cat = r.expense_categories?.name ?? 'Uncategorized';
      e.expense[cat] = (e.expense[cat] ?? 0) + Number(r.amount);
    }
    return Array.from(byCur.entries()).map(([currency, v]) => {
      const inc = Object.entries(v.income).map(([category, amount]) => ({ category, amount: Math.round((amount as number) * 100) / 100 }));
      const exp = Object.entries(v.expense).map(([category, amount]) => ({ category, amount: Math.round((amount as number) * 100) / 100 }));
      const incomeTotal = inc.reduce((s, x) => s + x.amount, 0);
      const expenseTotal = exp.reduce((s, x) => s + x.amount, 0);
      return { currency, income: inc, expense: exp, incomeTotal: Math.round(incomeTotal * 100) / 100, expenseTotal: Math.round(expenseTotal * 100) / 100, net: Math.round((incomeTotal - expenseTotal) * 100) / 100 };
    });
  };

  const current = await buildOne(startDate, endDate);
  let prior: any[] | null = null;
  if (compare) {
    const days = Math.round((new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime()) / 86400000) + 1;
    const priorEnd = new Date(new Date(startDate + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const priorStart = new Date(new Date(priorEnd + 'T00:00:00Z').getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
    prior = await buildOne(priorStart, priorEnd);
  }

  res.json({ period: { startDate, endDate }, current, prior });
}

// ── CASH-FLOW FORECAST ──────────────────────────────────────────────────
// Project net cash for the next N weeks. Inflows: upcoming installments not
// yet paid. Outflows: scheduled staff payments + recurring expenses by their
// next_due_date (rolled forward through the horizon at their cadence).
export async function getCashFlowForecast(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const weeks = Math.min(52, Math.max(1, parseInt((req.query.weeks as string) || '12', 10)));
  const defaultCurrency = await getDefaultCurrency(schoolId);

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + weeks * 7 * 86400000);

  const [{ data: sfs }, { data: insts }, { data: pays }, { data: staff }, { data: tmpls }] = await Promise.all([
    supabase.from('student_fees').select('id, fee_plan_id, total_amount, adjustment, fee_plans(currency)').eq('school_id', schoolId),
    supabase.from('fee_installments').select('id, fee_plan_id, sequence, amount, due_date').eq('school_id', schoolId),
    supabase.from('fee_payments').select('student_fee_id, amount, is_refund').eq('school_id', schoolId).is('voided_at', null),
    supabase.from('staff_members').select('id, salary_amount, currency, next_payment_date').eq('school_id', schoolId).is('voided_at', null).eq('is_active', true).not('next_payment_date', 'is', null),
    supabase.from('expense_recurring_templates').select('id, name, amount, currency, cadence, next_due_date').eq('school_id', schoolId).eq('is_active', true).not('next_due_date', 'is', null),
  ]);

  const paidBySf = new Map<string, number>();
  for (const p of (pays ?? []) as any[]) {
    const sign = p.is_refund ? -1 : 1;
    paidBySf.set(p.student_fee_id, (paidBySf.get(p.student_fee_id) ?? 0) + sign * Number(p.amount));
  }
  const instByPlan = new Map<string, { id: string; sequence: number; amount: number; due_date: string }[]>();
  for (const i of (insts ?? []) as any[]) {
    const arr = instByPlan.get(i.fee_plan_id) ?? [];
    arr.push({ id: i.id, sequence: i.sequence, amount: Number(i.amount), due_date: i.due_date });
    instByPlan.set(i.fee_plan_id, arr);
  }

  interface Event { date: string; currency: string; amount: number; kind: 'inflow' | 'outflow'; label: string }
  const events: Event[] = [];

  // Inflows from outstanding installments
  for (const sf of (sfs ?? []) as any[]) {
    const cur = sf.fee_plans?.currency ?? defaultCurrency;
    const installments = (instByPlan.get(sf.fee_plan_id) ?? []).sort((a, b) => a.sequence - b.sequence);
    let remainingPaid = paidBySf.get(sf.id) ?? 0;
    for (const inst of installments) {
      const unpaid = Math.max(0, inst.amount - remainingPaid);
      remainingPaid = Math.max(0, remainingPaid - inst.amount);
      if (unpaid < 0.01) continue;
      const d = new Date(inst.due_date + 'T00:00:00Z');
      if (d > horizon) continue; // beyond horizon
      events.push({ date: inst.due_date, currency: cur, amount: unpaid, kind: 'inflow', label: 'Tuition installment' });
    }
  }
  // Outflows: staff next payment
  for (const s of (staff ?? []) as any[]) {
    const d = new Date(s.next_payment_date + 'T00:00:00Z');
    if (d > horizon) continue;
    events.push({ date: s.next_payment_date, currency: s.currency || defaultCurrency, amount: Number(s.salary_amount), kind: 'outflow', label: 'Salary' });
  }
  // Outflows: recurring expenses rolled forward through horizon
  for (const t of (tmpls ?? []) as any[]) {
    const cadenceDays: Record<string, number> = { monthly: 30, quarterly: 91, yearly: 365 };
    let cursor = new Date(t.next_due_date + 'T00:00:00Z');
    while (cursor <= horizon) {
      events.push({ date: cursor.toISOString().slice(0, 10), currency: t.currency || defaultCurrency, amount: Number(t.amount), kind: 'outflow', label: t.name });
      cursor = new Date(cursor.getTime() + (cadenceDays[t.cadence] ?? 30) * 86400000);
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Bucket by week
  const weeksOut: { weekStart: string; byCurrency: Record<string, { inflow: number; outflow: number; net: number }> }[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = new Date(today.getTime() + w * 7 * 86400000).toISOString().slice(0, 10);
    weeksOut.push({ weekStart: start, byCurrency: {} });
  }
  for (const e of events) {
    const eMs = new Date(e.date + 'T00:00:00Z').getTime();
    const idx = Math.floor((eMs - today.getTime()) / (7 * 86400000));
    if (idx < 0 || idx >= weeks) continue;
    const slot = weeksOut[idx];
    const cur = slot.byCurrency[e.currency] ?? { inflow: 0, outflow: 0, net: 0 };
    if (e.kind === 'inflow') cur.inflow += e.amount;
    else cur.outflow += e.amount;
    cur.net = Math.round((cur.inflow - cur.outflow) * 100) / 100;
    slot.byCurrency[e.currency] = cur;
  }

  res.json({ weeks: weeksOut, events });
}

// ── TAX REPORT ───────────────────────────────────────────────────────────
// Sum of tax_amount across payments / expenses / salaries in a date range,
// grouped by tax_label and currency. Tax-untagged rows are bucketed as "(Unlabeled)".
export async function getTaxReport(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const startDate = (req.query.startDate as string | undefined) || '';
  const endDate = (req.query.endDate as string | undefined) || '';
  if (!startDate || !endDate) { res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' }); return; }
  const defaultCurrency = await getDefaultCurrency(schoolId);

  const [{ data: fp }, { data: ssp }, { data: ex }] = await Promise.all([
    supabase.from('fee_payments').select('tax_amount, tax_label, currency').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', startDate).lte('paid_on', endDate).gt('tax_amount', 0),
    supabase.from('staff_salary_payments').select('tax_amount, tax_label, currency').eq('school_id', schoolId).is('voided_at', null).gte('paid_on', startDate).lte('paid_on', endDate).gt('tax_amount', 0),
    supabase.from('expenses').select('tax_amount, tax_label, currency').eq('school_id', schoolId).is('voided_at', null).gte('expense_date', startDate).lte('expense_date', endDate).gt('tax_amount', 0),
  ]);

  interface TaxRow { source: 'fee_payment' | 'staff_salary_payment' | 'expense'; label: string; currency: string; amount: number }
  const rows: TaxRow[] = [];
  const push = (source: TaxRow['source'], list: any[]) => {
    for (const r of list ?? []) {
      rows.push({ source, label: r.tax_label || '(Unlabeled)', currency: r.currency ?? defaultCurrency, amount: Number(r.tax_amount) });
    }
  };
  push('fee_payment', fp ?? []);
  push('staff_salary_payment', ssp ?? []);
  push('expense', ex ?? []);

  // Group by (source, label, currency)
  const grouped = new Map<string, TaxRow>();
  for (const r of rows) {
    const k = `${r.source}|${r.label}|${r.currency}`;
    const slot = grouped.get(k) ?? { ...r, amount: 0 };
    slot.amount += r.amount;
    grouped.set(k, slot);
  }

  res.json({
    period: { startDate, endDate },
    rows: Array.from(grouped.values()).map(r => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount),
  });
}

// ── MULTI-CURRENCY ROLLUP ───────────────────────────────────────────────
// Take an array of {amount, currency} entries and return per-currency totals
// + an optional consolidated total in `toCurrency` using fx_rates. Exposed
// as a generic helper so the ledger page can also call it.
export async function rollupCurrencies(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { amounts, toCurrency, asOf } = req.body as {
    amounts?: { amount: number; currency: string }[];
    toCurrency?: string;
    asOf?: string;
  };
  if (!Array.isArray(amounts)) { res.status(400).json({ error: 'amounts must be an array' }); return; }

  const byCur = new Map<string, number>();
  for (const a of amounts) {
    if (!a?.currency || typeof a.amount !== 'number') continue;
    byCur.set(a.currency, (byCur.get(a.currency) ?? 0) + a.amount);
  }
  const perCurrency = Array.from(byCur.entries()).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));

  let consolidated: { currency: string; amount: number; missingRates: string[] } | null = null;
  if (toCurrency) {
    const missing: string[] = [];
    let total = 0;
    for (const { currency, amount } of perCurrency) {
      const converted = await convertAmount(schoolId, amount, currency, toCurrency, asOf);
      if (converted === null) missing.push(currency);
      else total += converted;
    }
    consolidated = { currency: toCurrency, amount: Math.round(total * 100) / 100, missingRates: missing };
  }

  res.json({ perCurrency, consolidated });
}
