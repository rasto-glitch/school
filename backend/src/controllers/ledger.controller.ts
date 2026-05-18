import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { streamLedgerPdf, buildLedgerXlsx } from '../utils/ledgerExport';

// Aggregate ledger across all financial entry sources:
//   - fee_payments        → income  (Tuition)
//   - staff_salary_payments → expense (Salary)
//   - expenses            → expense (Operating expenses)
// Voided rows are excluded. Date-range filtered on each source's natural date.

interface LedgerRow {
  id: string;
  date: string;             // YYYY-MM-DD
  type: 'income' | 'expense';
  source: 'fee_payment' | 'staff_salary_payment' | 'expense';
  category: string;         // "Tuition", "Salary", or expense category name (or "Uncategorized")
  description: string;
  amount: number;
  currency: string;
  reference: string | null; // method / reference / vendor — secondary detail
}

interface CurrencyTotals {
  currency: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

interface CategoryTotal {
  category: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
}

interface LedgerAggregate {
  rows: LedgerRow[];
  totals: CurrencyTotals[];
  categories: CategoryTotal[];
  defaultCurrency: string;
  startDate: string | null;
  endDate: string | null;
}

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

async function getSchoolMeta(schoolId: string): Promise<{ name: string; logoUrl: string | null }> {
  const { data } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).single();
  return { name: data?.name ?? 'School', logoUrl: (data as { logo_url?: string | null })?.logo_url ?? null };
}

async function buildLedger(
  schoolId: string,
  filters: { startDate?: string; endDate?: string; sources?: string; currency?: string },
): Promise<{ ok: true; data: LedgerAggregate } | { ok: false; status: number; error: string }> {
  const { startDate, endDate, sources, currency } = filters;
  const wantSources = (sources?.split(',').map(s => s.trim()).filter(Boolean) ?? []) as Array<LedgerRow['source']>;
  const include = (s: LedgerRow['source']) => wantSources.length === 0 || wantSources.includes(s);

  const defaultCurrency = await getDefaultCurrency(schoolId);
  const rows: LedgerRow[] = [];

  // ── Tuition payments ──
  if (include('fee_payment')) {
    let q = supabase
      .from('fee_payments')
      .select('id, amount, paid_on, method, reference, notes, currency, is_refund, refund_of_payment_id, receipt_year, receipt_number, student_fee_id, student_fees(student_id, students(full_name), fee_plans(kind))')
      .eq('school_id', schoolId)
      .is('voided_at', null);
    if (startDate) q = q.gte('paid_on', startDate);
    if (endDate) q = q.lte('paid_on', endDate);
    const { data, error } = await q;
    if (error) return { ok: false, status: 500, error: `Tuition: ${error.message}` };
    for (const p of (data ?? []) as any[]) {
      const studentName = p.student_fees?.students?.full_name ?? 'Student';
      const kindLabel = (p.student_fees?.fee_plans?.kind as string | undefined) ?? 'tuition';
      const category = p.is_refund ? 'Refund' : kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);
      const receipt = (p.receipt_year && p.receipt_number)
        ? `RCP-${p.receipt_year}-${String(p.receipt_number).padStart(5, '0')}`
        : null;
      rows.push({
        id: `fp:${p.id}`,
        date: p.paid_on,
        // Refunds flow OUT of cash — represent as expense so net math is correct.
        type: p.is_refund ? 'expense' : 'income',
        source: 'fee_payment',
        category,
        description: p.is_refund ? `Refund — ${studentName}` : `${category} payment — ${studentName}`,
        amount: Number(p.amount) || 0,
        currency: p.currency || defaultCurrency,
        reference: [receipt, p.method, p.reference].filter(Boolean).join(' · ') || null,
      });
    }
  }

  // ── Staff salary payments ──
  if (include('staff_salary_payment')) {
    let q = supabase
      .from('staff_salary_payments')
      .select('id, amount, currency, paid_on, period_label, notes, insurance_amount, staff:staff_members(full_name, position)')
      .eq('school_id', schoolId)
      .is('voided_at', null);
    if (startDate) q = q.gte('paid_on', startDate);
    if (endDate) q = q.lte('paid_on', endDate);
    const { data, error } = await q;
    if (error) return { ok: false, status: 500, error: `Salaries: ${error.message}` };
    for (const p of (data ?? []) as any[]) {
      const name = p.staff?.full_name ?? 'Staff';
      const ins = Number(p.insurance_amount) || 0;
      // The cash that left the school = amount + insurance withheld? Actually
      // the existing salary form posts `amount` as net paid out and `insurance_amount`
      // is held aside. We treat `amount` as the cash expense for the ledger.
      rows.push({
        id: `ssp:${p.id}`,
        date: p.paid_on,
        type: 'expense',
        source: 'staff_salary_payment',
        category: 'Salary',
        description: `Salary — ${name}${p.period_label ? ` (${p.period_label})` : ''}`,
        amount: Number(p.amount) || 0,
        currency: p.currency || defaultCurrency,
        reference: ins > 0 ? `Insurance held: ${ins}` : null,
      });
    }
  }

  // ── Operating expenses ──
  if (include('expense')) {
    let q = supabase
      .from('expenses')
      .select('id, name, amount, currency, expense_date, vendor, payment_method, notes, category:expense_categories(name)')
      .eq('school_id', schoolId)
      .is('voided_at', null);
    if (startDate) q = q.gte('expense_date', startDate);
    if (endDate) q = q.lte('expense_date', endDate);
    const { data, error } = await q;
    if (error) return { ok: false, status: 500, error: `Expenses: ${error.message}` };
    for (const e of (data ?? []) as any[]) {
      rows.push({
        id: `ex:${e.id}`,
        date: e.expense_date,
        type: 'expense',
        source: 'expense',
        category: e.category?.name ?? 'Uncategorized',
        description: e.name,
        amount: Number(e.amount) || 0,
        currency: e.currency || defaultCurrency,
        reference: [e.vendor, e.payment_method].filter(Boolean).join(' · ') || null,
      });
    }
  }

  const filtered = currency ? rows.filter(r => r.currency === currency) : rows;
  filtered.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    // Unique final tiebreak — makes the cursor slice deterministic and
    // keeps export row order stable across identical (date, source) groups.
    return a.id.localeCompare(b.id);
  });

  // Totals per currency
  const totalsByCurrency = new Map<string, CurrencyTotals>();
  for (const r of filtered) {
    let t = totalsByCurrency.get(r.currency);
    if (!t) {
      t = { currency: r.currency, income: 0, expense: 0, net: 0, count: 0 };
      totalsByCurrency.set(r.currency, t);
    }
    if (r.type === 'income') t.income += r.amount;
    else t.expense += r.amount;
    t.net = t.income - t.expense;
    t.count += 1;
  }

  // Category breakdown per currency
  const catKey = (cur: string, cat: string, type: 'income' | 'expense') => `${cur}|${type}|${cat}`;
  const catMap = new Map<string, CategoryTotal>();
  for (const r of filtered) {
    const k = catKey(r.currency, r.category, r.type);
    let c = catMap.get(k);
    if (!c) {
      c = { category: r.category, type: r.type, amount: 0, currency: r.currency };
      catMap.set(k, c);
    }
    c.amount += r.amount;
  }

  return {
    ok: true,
    data: {
      rows: filtered,
      totals: Array.from(totalsByCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
      categories: Array.from(catMap.values()).sort((a, b) => b.amount - a.amount),
      defaultCurrency,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    },
  };
}

// Page size for the ledger's row list. totals/categories are always
// computed over the WHOLE filtered set (in buildLedger) and returned
// untouched — a page boundary must never change a financial figure.
const LEDGER_PAGE = 50;

export async function getLedger(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const result = await buildLedger(schoolId, req.query as Record<string, string>);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }

  // Row-list pagination only. The ledger is an in-memory merge of 3 tables,
  // so buildLedger already has the full, fully-sorted set; we slice it.
  // `type` (income|expense) filters the visible rows but NOT the summary —
  // matching the page's prior client-side `typeFilter` semantics exactly.
  const typeFilter = String((req.query.type ?? '')).toLowerCase();
  const allRows = (typeFilter === 'income' || typeFilter === 'expense')
    ? result.data.rows.filter(r => r.type === typeFilter)
    : result.data.rows;

  const rawCursor = req.query.cursor;
  let startIdx = 0;
  if (typeof rawCursor === 'string' && rawCursor) {
    let cursorId = '';
    try { cursorId = Buffer.from(rawCursor, 'base64url').toString('utf8'); } catch { cursorId = ''; }
    if (cursorId) {
      const at = allRows.findIndex(r => r.id === cursorId);
      // Unknown cursor (data shifted) → start from the top, the safe
      // non-breaking default used everywhere else in this codebase.
      if (at >= 0) startIdx = at + 1;
    }
  }

  const pageRows = allRows.slice(startIdx, startIdx + LEDGER_PAGE);
  const hasMore = startIdx + LEDGER_PAGE < allRows.length;
  const nextCursor = hasMore && pageRows.length > 0
    ? Buffer.from(pageRows[pageRows.length - 1].id, 'utf8').toString('base64url')
    : null;

  res.json({
    ...result.data,
    rows: pageRows,
    nextCursor,
  });
}

export async function exportLedgerPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const result = await buildLedger(schoolId, req.query as Record<string, string>);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const meta = await getSchoolMeta(schoolId);

  const tag = `${result.data.startDate ?? 'all'}_to_${result.data.endDate ?? 'now'}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ledger-${tag}.pdf"`);
  await streamLedgerPdf(res, {
    schoolName: meta.name,
    schoolLogoUrl: meta.logoUrl,
    startDate: result.data.startDate,
    endDate: result.data.endDate,
    rows: result.data.rows.map(r => ({
      date: r.date, type: r.type, source: r.source, category: r.category,
      description: r.description, amount: r.amount, currency: r.currency, reference: r.reference,
    })),
    totals: result.data.totals,
    categories: result.data.categories,
  });
}

export async function exportLedgerXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const result = await buildLedger(schoolId, req.query as Record<string, string>);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const meta = await getSchoolMeta(schoolId);

  const buf = buildLedgerXlsx({
    schoolName: meta.name,
    schoolLogoUrl: meta.logoUrl,
    startDate: result.data.startDate,
    endDate: result.data.endDate,
    rows: result.data.rows.map(r => ({
      date: r.date, type: r.type, source: r.source, category: r.category,
      description: r.description, amount: r.amount, currency: r.currency, reference: r.reference,
    })),
    totals: result.data.totals,
    categories: result.data.categories,
  });
  const tag = `${result.data.startDate ?? 'all'}_to_${result.data.endDate ?? 'now'}`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ledger-${tag}.xlsx"`);
  res.send(buf);
}
