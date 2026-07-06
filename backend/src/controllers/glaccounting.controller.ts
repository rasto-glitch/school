import { Response } from 'express';
// Elevated controller — cross-row aggregation over the general ledger.
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { ensureChartSeeded } from '../utils/glSeed';
import { postEntryResult, type PostLine } from '../utils/glPosting';
import { assertPeriodOpen } from '../utils/period';
import { logAudit } from '../utils/audit';
import {
  streamTrialBalancePdf, streamIncomeStatementPdf, streamBalanceSheetPdf,
  buildTrialBalanceXlsx, buildIncomeStatementXlsx, buildBalanceSheetXlsx, buildJournalXlsx,
} from '../utils/glExport';

async function getSchoolMeta(schoolId: string): Promise<{ name: string; logoUrl: string | null }> {
  const { data } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).single();
  return { name: (data as any)?.name ?? 'School', logoUrl: (data as any)?.logo_url ?? null };
}

// GL is part of the accounting module — gated by the same premium flag.
async function ensurePremium(schoolId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase.from('schools').select('features').eq('id', schoolId).single();
  if ((data?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    return { ok: false, status: 403, error: 'Accounting module is not enabled for this school.' };
  }
  return { ok: true };
}

// ── Chart of accounts ────────────────────────────────────────────────────
export async function listAccounts(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  await ensureChartSeeded(schoolId);
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, type, subtype, currency, is_system, is_active, payment_account_id, expense_category_id')
    .eq('school_id', schoolId)
    .order('code', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map(toCC));
}

// ── Trial balance ──────────────────────────────────────────────────────────
// Ending balance per account, split into debit/credit columns and grouped by
// currency. Each currency block balances (total debit = total credit) because
// every entry balances. `asOf` (inclusive) optionally cuts off by entry_date.
export interface TBAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;   // ending balance shown in the debit column
  credit: number;  // ending balance shown in the credit column
}
export interface TBCurrency {
  currency: string;
  accounts: TBAccount[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export async function computeTrialBalance(schoolId: string, asOf: string | null): Promise<TBCurrency[]> {
  const agg = await aggregateLines(schoolId, { endDate: asOf });
  const byCurrency = new Map<string, TBCurrency>();
  for (const a of agg) {
    const net = round2(a.debit - a.credit);
    if (net === 0) continue; // hide fully-settled accounts from the trial balance
    let block = byCurrency.get(a.currency);
    if (!block) {
      block = { currency: a.currency, accounts: [], totalDebit: 0, totalCredit: 0, balanced: true };
      byCurrency.set(a.currency, block);
    }
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    block.accounts.push({ accountId: a.accountId, code: a.code, name: a.name, type: a.type, debit, credit });
    block.totalDebit = round2(block.totalDebit + debit);
    block.totalCredit = round2(block.totalCredit + credit);
  }
  const currencies = Array.from(byCurrency.values()).sort((x, y) => x.currency.localeCompare(y.currency));
  for (const block of currencies) {
    block.accounts.sort((x, y) => x.code.localeCompare(y.code));
    block.balanced = block.totalDebit === block.totalCredit;
  }
  return currencies;
}

export async function getTrialBalance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : null;
  try { res.json({ asOf, currencies: await computeTrialBalance(schoolId, asOf) }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
}

// ── Journal (entries with their lines) ──────────────────────────────────────
const JOURNAL_PAGE = 50;

export interface JournalRow {
  id: string; entryNo: number; entryDate: string; currency: string;
  memo: string | null; source: string; sourceId: string | null; isReversal: boolean;
  lines: { accountId: string; code: string; name: string; debit: number; credit: number; currency: string; description: string | null }[];
}

export async function computeJournal(schoolId: string, limit: number): Promise<JournalRow[]> {
  // Paged fetch: a single .limit(N) request is silently capped at the
  // PostgREST max-rows setting (~1000), so the "export the full journal"
  // path used to quietly export only the first page. Page size stays
  // under the cap; the loop stops at `limit` or when the table runs out.
  const PAGE = 500;
  const entries: any[] = [];
  for (let from = 0; entries.length < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1;
    const { data, error } = await supabase
      .from('journal_entries')
      .select('id, entry_no, entry_date, currency, memo, source, source_id, is_reversal')
      .eq('school_id', schoolId)
      .order('entry_no', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    entries.push(...(data ?? []));
    if (!data || data.length < to - from + 1) break;
  }

  // Lines in chunks: one giant .in() would blow the URL length long before
  // the id list blew the row cap.
  const ids = entries.map(e => e.id as string);
  const lines: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: chunk, error } = await supabase
      .from('journal_lines')
      .select('entry_id, debit, credit, currency, description, account_id, chart_of_accounts!inner(code, name)')
      .eq('school_id', schoolId)
      .in('entry_id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    lines.push(...(chunk ?? []));
  }

  const linesByEntry = new Map<string, JournalRow['lines']>();
  for (const l of (lines ?? []) as any[]) {
    const arr = linesByEntry.get(l.entry_id) ?? [];
    arr.push({
      accountId: l.account_id,
      code: l.chart_of_accounts?.code ?? '',
      name: l.chart_of_accounts?.name ?? '',
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      currency: l.currency,
      description: l.description ?? null,
    });
    linesByEntry.set(l.entry_id, arr);
  }

  return (entries ?? []).map(e => {
    const entry = e as any;
    const ls = (linesByEntry.get(entry.id) ?? []).sort((a, b) => (b.debit - a.debit) || a.code.localeCompare(b.code));
    return {
      id: entry.id, entryNo: entry.entry_no, entryDate: entry.entry_date, currency: entry.currency,
      memo: entry.memo, source: entry.source, sourceId: entry.source_id, isReversal: entry.is_reversal, lines: ls,
    };
  });
}

export async function listJournal(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  const limit = Math.min(Number(req.query.limit) || JOURNAL_PAGE, 200);
  try { res.json(await computeJournal(schoolId, limit)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
}

// ── Shared aggregation: sum debit/credit per (currency, account) over a date
// window. Account type/code/name come along via the inner join. ────────────
interface AggAccount {
  currency: string; accountId: string; code: string; name: string; type: string;
  debit: number; credit: number;
}
async function aggregateLines(schoolId: string, opts: { startDate?: string | null; endDate?: string | null }): Promise<AggAccount[]> {
  // SQL-side aggregation (migration 078, gl_aggregate_lines): the old
  // fetch-all-lines-and-sum-in-JS version silently truncated at the
  // PostgREST response cap (~1000 rows), so the trial balance / P&L /
  // balance sheet went quietly wrong once a school had real GL volume.
  // The RPC's result set is bounded by (currencies × chart accounts),
  // never by transaction volume.
  const { data, error } = await supabase.rpc('gl_aggregate_lines', {
    p_school_id: schoolId,
    p_start: opts.startDate ?? null,
    p_end: opts.endDate ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(r => ({
    currency: r.currency as string,
    accountId: r.account_id as string,
    code: (r.code as string) ?? '',
    name: (r.name as string) ?? '',
    type: (r.type as string) ?? '',
    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
  }));
}

// ── Income Statement (P&L) over [startDate, endDate] ─────────────────────────
export interface PLAccount { code: string; name: string; amount: number; }
export interface PLCurrency { currency: string; income: PLAccount[]; expense: PLAccount[]; totalIncome: number; totalExpense: number; netIncome: number; }

export async function computeIncomeStatement(schoolId: string, startDate: string | null, endDate: string | null): Promise<PLCurrency[]> {
  const agg = await aggregateLines(schoolId, { startDate, endDate });
  const byCur = new Map<string, PLCurrency>();
  const block = (cur: string): PLCurrency => {
    let b = byCur.get(cur);
    if (!b) { b = { currency: cur, income: [], expense: [], totalIncome: 0, totalExpense: 0, netIncome: 0 }; byCur.set(cur, b); }
    return b;
  };
  for (const a of agg) {
    if (a.type === 'income') {
      const amount = round2(a.credit - a.debit); // credit-normal
      if (amount === 0) continue;
      const b = block(a.currency);
      b.income.push({ code: a.code, name: a.name, amount });
      b.totalIncome = round2(b.totalIncome + amount);
    } else if (a.type === 'expense') {
      const amount = round2(a.debit - a.credit); // debit-normal
      if (amount === 0) continue;
      const b = block(a.currency);
      b.expense.push({ code: a.code, name: a.name, amount });
      b.totalExpense = round2(b.totalExpense + amount);
    }
  }
  const currencies = Array.from(byCur.values()).sort((x, y) => x.currency.localeCompare(y.currency));
  for (const b of currencies) {
    b.income.sort((x, y) => x.code.localeCompare(y.code));
    b.expense.sort((x, y) => x.code.localeCompare(y.code));
    b.netIncome = round2(b.totalIncome - b.totalExpense);
  }
  return currencies;
}

export async function getIncomeStatement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const startDate = typeof req.query.startDate === 'string' && req.query.startDate ? req.query.startDate : null;
  const endDate = typeof req.query.endDate === 'string' && req.query.endDate ? req.query.endDate : null;
  try { res.json({ startDate, endDate, currencies: await computeIncomeStatement(schoolId, startDate, endDate) }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
}

// ── Balance Sheet as of a date. Equity section includes a synthetic
// "Current period earnings" line (= cumulative income − expense), without
// which Assets = Liabilities + Equity would not hold (no period-close entries
// roll P&L into retained earnings yet). ─────────────────────────────────────
export interface BSAccount { code: string; name: string; amount: number; }
export interface BSCurrency {
  currency: string;
  assets: BSAccount[]; liabilities: BSAccount[]; equity: BSAccount[];
  currentEarnings: number;
  totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean;
}

export async function computeBalanceSheet(schoolId: string, asOf: string | null): Promise<BSCurrency[]> {
  const agg = await aggregateLines(schoolId, { endDate: asOf });
  const byCur = new Map<string, BSCurrency>();
  const block = (cur: string): BSCurrency => {
    let b = byCur.get(cur);
    if (!b) { b = { currency: cur, assets: [], liabilities: [], equity: [], currentEarnings: 0, totalAssets: 0, totalLiabilities: 0, totalEquity: 0, balanced: true }; byCur.set(cur, b); }
    return b;
  };
  for (const a of agg) {
    const b = block(a.currency);
    if (a.type === 'asset') {
      const amount = round2(a.debit - a.credit);
      if (amount !== 0) { b.assets.push({ code: a.code, name: a.name, amount }); b.totalAssets = round2(b.totalAssets + amount); }
    } else if (a.type === 'liability') {
      const amount = round2(a.credit - a.debit);
      if (amount !== 0) { b.liabilities.push({ code: a.code, name: a.name, amount }); b.totalLiabilities = round2(b.totalLiabilities + amount); }
    } else if (a.type === 'equity') {
      const amount = round2(a.credit - a.debit);
      if (amount !== 0) { b.equity.push({ code: a.code, name: a.name, amount }); b.totalEquity = round2(b.totalEquity + amount); }
    } else if (a.type === 'income') {
      b.currentEarnings = round2(b.currentEarnings + (a.credit - a.debit));
    } else if (a.type === 'expense') {
      b.currentEarnings = round2(b.currentEarnings - (a.debit - a.credit));
    }
  }
  const currencies = Array.from(byCur.values()).sort((x, y) => x.currency.localeCompare(y.currency));
  for (const b of currencies) {
    b.assets.sort((x, y) => x.code.localeCompare(y.code));
    b.liabilities.sort((x, y) => x.code.localeCompare(y.code));
    b.equity.sort((x, y) => x.code.localeCompare(y.code));
    b.totalEquity = round2(b.totalEquity + b.currentEarnings); // fold earnings into equity total
    b.balanced = b.totalAssets === round2(b.totalLiabilities + b.totalEquity);
  }
  return currencies;
}

export async function getBalanceSheet(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : null;
  try { res.json({ asOf, currencies: await computeBalanceSheet(schoolId, asOf) }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
}

// ── Account drill-down: every line for one account over a window, with a
// running balance (in the account's normal direction), grouped by currency. ─
export async function getAccountLedger(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const accountId = String(req.params.id);
  const startDate = typeof req.query.startDate === 'string' && req.query.startDate ? req.query.startDate : null;
  const endDate = typeof req.query.endDate === 'string' && req.query.endDate ? req.query.endDate : null;

  const { data: acct } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, type')
    .eq('school_id', schoolId).eq('id', accountId).single();
  if (!acct) { res.status(404).json({ error: 'Account not found' }); return; }
  const debitNormal = acct.type === 'asset' || acct.type === 'expense';

  const { data, error } = await supabase
    .from('journal_lines')
    .select('debit, credit, currency, description, entry_id, journal_entries!inner(entry_no, entry_date, memo, source)')
    .eq('school_id', schoolId)
    .eq('account_id', accountId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  interface Row { entryId: string; entryNo: number; date: string; memo: string | null; source: string; debit: number; credit: number; balance: number; }
  interface CurBlock { currency: string; opening: number; rows: Row[]; closing: number; }
  const byCur = new Map<string, { opening: number; within: any[] }>();

  for (const l of (data ?? []) as any[]) {
    const cur = l.currency as string;
    const date = l.journal_entries?.entry_date as string;
    const signed = debitNormal ? (Number(l.debit) - Number(l.credit)) : (Number(l.credit) - Number(l.debit));
    let g = byCur.get(cur);
    if (!g) { g = { opening: 0, within: [] }; byCur.set(cur, g); }
    if (startDate && date < startDate) {
      g.opening = round2(g.opening + signed); // before the window → folds into opening balance
    } else if (endDate && date > endDate) {
      // after the window → ignore
    } else {
      g.within.push(l);
    }
  }

  const currencies: CurBlock[] = [];
  for (const [cur, g] of byCur.entries()) {
    g.within.sort((a, b) => {
      const da = a.journal_entries?.entry_date ?? ''; const db = b.journal_entries?.entry_date ?? '';
      if (da !== db) return da < db ? -1 : 1;
      return (a.journal_entries?.entry_no ?? 0) - (b.journal_entries?.entry_no ?? 0);
    });
    let running = g.opening;
    const rows: Row[] = g.within.map(l => {
      const signed = debitNormal ? (Number(l.debit) - Number(l.credit)) : (Number(l.credit) - Number(l.debit));
      running = round2(running + signed);
      return {
        entryId: l.entry_id,
        entryNo: l.journal_entries?.entry_no ?? 0,
        date: l.journal_entries?.entry_date,
        memo: l.journal_entries?.memo ?? null,
        source: l.journal_entries?.source ?? '',
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        balance: running,
      };
    });
    currencies.push({ currency: cur, opening: round2(g.opening), rows, closing: running });
  }
  currencies.sort((a, b) => a.currency.localeCompare(b.currency));

  res.json({
    account: { id: acct.id, code: acct.code, name: acct.name, type: acct.type },
    debitNormal, startDate, endDate, currencies,
  });
}

// ── Chart-of-accounts management (Phase 4) ──────────────────────────────────
export async function createAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const { code, name, type, subtype } = req.body as { code: string; name: string; type: string; subtype?: string | null };
  const { data: clash } = await supabase
    .from('chart_of_accounts').select('id').eq('school_id', schoolId).eq('code', code.trim()).limit(1);
  if (clash && clash.length) { res.status(409).json({ error: `Account code ${code.trim()} already exists` }); return; }

  const { data, error } = await supabase.from('chart_of_accounts').insert({
    school_id: schoolId, code: code.trim(), name: name.trim(), type,
    subtype: subtype?.trim() || null, is_system: false, is_active: true,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // HD-4 — accountant CRUD on the chart was previously unaudited.
  await logAudit({ req, entityType: 'chart_of_account', entityId: String(data.id), action: 'create', after: data, label: `${data.code} ${data.name}` });
  res.status(201).json(toCC(data));
}

export async function updateAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  const { name, subtype, isActive } = req.body as { name?: string; subtype?: string | null; isActive?: boolean };

  // HD-4 — pull the full row so the audit diff captures every field that
  // actually changed (name + subtype + is_active), not just the is_system flag.
  const { data: before } = await supabase
    .from('chart_of_accounts').select('*').eq('school_id', schoolId).eq('id', id).single();
  if (!before) { res.status(404).json({ error: 'Account not found' }); return; }
  // System accounts are renamable but must stay active — posting depends on them.
  if (isActive === false && (before as { is_system: boolean }).is_system) {
    res.status(409).json({ error: 'System accounts cannot be deactivated' }); return;
  }

  const updates: Record<string, unknown> = {};
  if (typeof name === 'string') { if (!name.trim()) { res.status(400).json({ error: 'Name cannot be empty' }); return; } updates.name = name.trim(); }
  if (subtype !== undefined) updates.subtype = subtype?.trim() || null;
  if (isActive !== undefined) updates.is_active = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const { data: after, error } = await supabase.from('chart_of_accounts')
    .update(updates).eq('school_id', schoolId).eq('id', id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'chart_of_account', entityId: id, action: 'update', before, after, label: `${(after as any).code} ${(after as any).name}` });
  res.json(toCC(after));
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  // HD-4 — capture the full row before deletion so the audit log keeps a
  // recoverable snapshot of what was removed.
  const { data: acct } = await supabase
    .from('chart_of_accounts').select('*').eq('school_id', schoolId).eq('id', id).single();
  if (!acct) { res.status(404).json({ error: 'Account not found' }); return; }
  if ((acct as { is_system: boolean }).is_system) { res.status(409).json({ error: 'System accounts cannot be deleted' }); return; }

  const { data: used } = await supabase
    .from('journal_lines').select('id').eq('school_id', schoolId).eq('account_id', id).limit(1);
  if (used && used.length) { res.status(409).json({ error: 'Account has journal entries — deactivate it instead' }); return; }

  const { error } = await supabase.from('chart_of_accounts').delete().eq('school_id', schoolId).eq('id', id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'chart_of_account', entityId: id, action: 'delete', before: acct, label: `${(acct as any).code} ${(acct as any).name}` });
  res.json({ success: true });
}

// ── Manual journal entry (Phase 4) ──────────────────────────────────────────
interface RawLine { accountId: string; debit?: number; credit?: number; description?: string | null }

export async function createJournalEntry(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const { entryDate, currency, memo, source, lines: rawLines } = req.body as {
    entryDate: string; currency: string; memo?: string | null; source?: 'manual' | 'opening'; lines: RawLine[];
  };

  // Each line must be a debit XOR a credit, strictly positive on one side.
  const lines: PostLine[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const l of rawLines) {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    if ((debit > 0) === (credit > 0)) { res.status(400).json({ error: 'Each line must have either a debit or a credit (not both, not neither)' }); return; }
    totalDebit += debit; totalCredit += credit;
    lines.push({ accountId: l.accountId, debit, credit, description: l.description?.trim() || null });
  }
  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    res.status(400).json({ error: `Entry does not balance: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}` }); return;
  }

  // Every account must belong to this school and be active.
  const accountIds = Array.from(new Set(lines.map(l => l.accountId)));
  const { data: accts } = await supabase
    .from('chart_of_accounts').select('id, is_active').eq('school_id', schoolId).in('id', accountIds);
  const okIds = new Set((accts ?? []).filter(a => (a as any).is_active).map(a => (a as any).id));
  for (const aid of accountIds) {
    if (!okIds.has(aid)) { res.status(400).json({ error: 'A line references an unknown or inactive account' }); return; }
  }

  // Period-close guard — the journal-level enforcement that auto-posting got
  // for free (it always ran downstream of a controller period check).
  const periodGuard = await assertPeriodOpen(schoolId, [entryDate]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const result = await postEntryResult({
    schoolId, entryDate, currency, source: source === 'opening' ? 'opening' : 'manual',
    memo: memo?.trim() || (source === 'opening' ? 'Opening balance' : 'Manual entry'),
    postedBy: userId, lines,
  });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  // HD-4 — manual journal entries are the highest-trust accountant write
  // path. The GL chain itself is hash-chained, but logAudit also gives the
  // admin viewer a labelled record of "who posted what and when."
  await logAudit({
    req, entityType: 'journal_entry', entityId: result.entryId, action: 'create',
    after: { entryDate, currency, memo: memo?.trim() || null, source: source === 'opening' ? 'opening' : 'manual', totalDebit, totalCredit, lineCount: lines.length },
    label: `${entryDate} · ${currency} · ${totalDebit.toFixed(2)}`,
  });
  res.status(201).json({ id: result.entryId });
}

// ── Opening balances (Phase 4) ──────────────────────────────────────────────
// One normal-direction amount per account; the difference is plugged into
// Opening Balance Equity (3000) so the entry balances.
export async function postOpeningBalances(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const { asOf, currency, memo, balances } = req.body as {
    asOf?: string; currency: string; memo?: string | null; balances: { accountId: string; amount: number }[];
  };
  const entryDate = asOf || new Date().toISOString().slice(0, 10);

  const { data: accts } = await supabase
    .from('chart_of_accounts').select('id, code, type, is_active').eq('school_id', schoolId);
  const byId = new Map((accts ?? []).map(a => [(a as any).id, a as any]));
  const obe = (accts ?? []).find(a => (a as any).code === '3000');
  if (!obe) { res.status(500).json({ error: 'Opening Balance Equity account (3000) is missing' }); return; }

  const lines: PostLine[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const b of balances) {
    const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
    if (amount === 0) continue;
    const acc = byId.get(b.accountId);
    if (!acc || !acc.is_active) { res.status(400).json({ error: 'A balance references an unknown or inactive account' }); return; }
    if (acc.id === (obe as any).id) continue; // never set OBE directly — it's the plug
    const debitNormal = acc.type === 'asset' || acc.type === 'expense';
    // Positive amount sits on the account's normal side; negative flips it.
    const onDebit = debitNormal ? amount > 0 : amount < 0;
    const mag = Math.abs(amount);
    if (onDebit) { lines.push({ accountId: acc.id, debit: mag, description: 'Opening balance' }); totalDebit += mag; }
    else { lines.push({ accountId: acc.id, credit: mag, description: 'Opening balance' }); totalCredit += mag; }
  }
  if (lines.length === 0) { res.status(400).json({ error: 'No non-zero opening balances provided' }); return; }

  // Plug the difference into Opening Balance Equity so the entry balances.
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
  if (diff > 0) lines.push({ accountId: (obe as any).id, credit: diff, description: 'Opening balance equity' });
  else if (diff < 0) lines.push({ accountId: (obe as any).id, debit: -diff, description: 'Opening balance equity' });

  const periodGuard = await assertPeriodOpen(schoolId, [entryDate]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const result = await postEntryResult({
    schoolId, entryDate, currency, source: 'opening',
    memo: memo?.trim() || 'Opening balances', postedBy: userId, lines,
  });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  // HD-4 — opening balances are a once-per-school event; auditing them is
  // worth more than any other manual entry.
  await logAudit({
    req, entityType: 'journal_entry', entityId: result.entryId, action: 'create',
    after: { entryDate, currency, memo: memo?.trim() || 'Opening balances', source: 'opening', totalDebit, totalCredit, lineCount: lines.length },
    label: `Opening balances · ${entryDate} · ${currency}`,
  });
  res.status(201).json({ id: result.entryId });
}

// ── Exports (Phase 4): PDF for the statements, XLSX for everything ──────────
const qstr = (req: AuthRequest, k: string): string | null => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : null);

export async function exportTrialBalancePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = qstr(req, 'asOf');
  const [meta, currencies] = await Promise.all([getSchoolMeta(schoolId), computeTrialBalance(schoolId, asOf)]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${asOf ?? 'today'}.pdf"`);
  await streamTrialBalancePdf(res, { schoolName: meta.name, logoUrl: meta.logoUrl, asOf, currencies });
}

export async function exportTrialBalanceXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = qstr(req, 'asOf');
  const buf = buildTrialBalanceXlsx({ currencies: await computeTrialBalance(schoolId, asOf) });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${asOf ?? 'today'}.xlsx"`);
  res.send(buf);
}

export async function exportIncomeStatementPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const startDate = qstr(req, 'startDate'); const endDate = qstr(req, 'endDate');
  const [meta, currencies] = await Promise.all([getSchoolMeta(schoolId), computeIncomeStatement(schoolId, startDate, endDate)]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="income-statement-${startDate ?? 'all'}-to-${endDate ?? 'now'}.pdf"`);
  await streamIncomeStatementPdf(res, { schoolName: meta.name, logoUrl: meta.logoUrl, startDate, endDate, currencies });
}

export async function exportIncomeStatementXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const startDate = qstr(req, 'startDate'); const endDate = qstr(req, 'endDate');
  const buf = buildIncomeStatementXlsx({ currencies: await computeIncomeStatement(schoolId, startDate, endDate) });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="income-statement-${startDate ?? 'all'}-to-${endDate ?? 'now'}.xlsx"`);
  res.send(buf);
}

export async function exportBalanceSheetPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = qstr(req, 'asOf');
  const [meta, currencies] = await Promise.all([getSchoolMeta(schoolId), computeBalanceSheet(schoolId, asOf)]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${asOf ?? 'today'}.pdf"`);
  await streamBalanceSheetPdf(res, { schoolName: meta.name, logoUrl: meta.logoUrl, asOf, currencies });
}

export async function exportBalanceSheetXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);
  const asOf = qstr(req, 'asOf');
  const buf = buildBalanceSheetXlsx({ currencies: await computeBalanceSheet(schoolId, asOf) });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${asOf ?? 'today'}.xlsx"`);
  res.send(buf);
}

export async function exportJournalXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  // Export the full journal (capped high), not just the on-screen page.
  const entries = await computeJournal(schoolId, 100000);
  const buf = buildJournalXlsx({ entries });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="journal-${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.send(buf);
}
