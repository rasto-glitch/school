import { Response } from 'express';
// Elevated controller — cross-row aggregation over the general ledger.
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { ensureChartSeeded } from '../utils/glSeed';
import { postEntryResult, type PostLine } from '../utils/glPosting';
import { assertPeriodOpen } from '../utils/period';

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
interface TBAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;   // ending balance shown in the debit column
  credit: number;  // ending balance shown in the credit column
}
interface TBCurrency {
  currency: string;
  accounts: TBAccount[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export async function getTrialBalance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const asOf = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : null;

  let q = supabase
    .from('journal_lines')
    .select('debit, credit, currency, account_id, chart_of_accounts!inner(code, name, type), journal_entries!inner(entry_date)')
    .eq('school_id', schoolId);
  if (asOf) q = q.lte('journal_entries.entry_date', asOf);
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Aggregate per (currency, account): net = sum(debit) - sum(credit).
  const key = (cur: string, acc: string) => `${cur}|${acc}`;
  const agg = new Map<string, { currency: string; accountId: string; code: string; name: string; type: string; net: number }>();
  for (const row of (data ?? []) as any[]) {
    const cur = row.currency as string;
    const acc = row.account_id as string;
    const coa = row.chart_of_accounts ?? {};
    const k = key(cur, acc);
    let a = agg.get(k);
    if (!a) {
      a = { currency: cur, accountId: acc, code: coa.code ?? '', name: coa.name ?? '', type: coa.type ?? '', net: 0 };
      agg.set(k, a);
    }
    a.net += (Number(row.debit) || 0) - (Number(row.credit) || 0);
  }

  const byCurrency = new Map<string, TBCurrency>();
  for (const a of agg.values()) {
    const net = round2(a.net);
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

  res.json({ asOf, currencies });
}

// ── Journal (recent entries with their lines) ───────────────────────────────
const JOURNAL_PAGE = 50;

export async function listJournal(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const limit = Math.min(Number(req.query.limit) || JOURNAL_PAGE, 200);
  const { data: entries, error } = await supabase
    .from('journal_entries')
    .select('id, entry_no, entry_date, currency, memo, source, source_id, is_reversal')
    .eq('school_id', schoolId)
    .order('entry_no', { ascending: false })
    .limit(limit);
  if (error) { res.status(500).json({ error: error.message }); return; }

  const ids = (entries ?? []).map(e => (e as any).id);
  const { data: lines } = ids.length
    ? await supabase
        .from('journal_lines')
        .select('entry_id, debit, credit, currency, description, account_id, chart_of_accounts!inner(code, name)')
        .eq('school_id', schoolId)
        .in('entry_id', ids)
    : { data: [] as any[] };

  const linesByEntry = new Map<string, any[]>();
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

  const rows = (entries ?? []).map(e => {
    const entry = e as any;
    const ls = (linesByEntry.get(entry.id) ?? []).sort((a, b) => (b.debit - a.debit) || a.code.localeCompare(b.code));
    return {
      id: entry.id,
      entryNo: entry.entry_no,
      entryDate: entry.entry_date,
      currency: entry.currency,
      memo: entry.memo,
      source: entry.source,
      sourceId: entry.source_id,
      isReversal: entry.is_reversal,
      lines: ls,
    };
  });
  res.json(rows);
}

// ── Shared aggregation: sum debit/credit per (currency, account) over a date
// window. Account type/code/name come along via the inner join. ────────────
interface AggAccount {
  currency: string; accountId: string; code: string; name: string; type: string;
  debit: number; credit: number;
}
async function aggregateLines(schoolId: string, opts: { startDate?: string | null; endDate?: string | null }): Promise<AggAccount[]> {
  let q = supabase
    .from('journal_lines')
    .select('debit, credit, currency, account_id, chart_of_accounts!inner(code, name, type), journal_entries!inner(entry_date)')
    .eq('school_id', schoolId);
  if (opts.startDate) q = q.gte('journal_entries.entry_date', opts.startDate);
  if (opts.endDate) q = q.lte('journal_entries.entry_date', opts.endDate);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const map = new Map<string, AggAccount>();
  for (const row of (data ?? []) as any[]) {
    const cur = row.currency as string;
    const acc = row.account_id as string;
    const coa = row.chart_of_accounts ?? {};
    const k = `${cur}|${acc}`;
    let a = map.get(k);
    if (!a) { a = { currency: cur, accountId: acc, code: coa.code ?? '', name: coa.name ?? '', type: coa.type ?? '', debit: 0, credit: 0 }; map.set(k, a); }
    a.debit += Number(row.debit) || 0;
    a.credit += Number(row.credit) || 0;
  }
  return Array.from(map.values());
}

// ── Income Statement (P&L) over [startDate, endDate] ─────────────────────────
interface PLAccount { code: string; name: string; amount: number; }
export async function getIncomeStatement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const startDate = typeof req.query.startDate === 'string' && req.query.startDate ? req.query.startDate : null;
  const endDate = typeof req.query.endDate === 'string' && req.query.endDate ? req.query.endDate : null;

  let agg: AggAccount[];
  try { agg = await aggregateLines(schoolId, { startDate, endDate }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }

  interface PLBlock { currency: string; income: PLAccount[]; expense: PLAccount[]; totalIncome: number; totalExpense: number; netIncome: number; }
  const byCur = new Map<string, PLBlock>();
  const block = (cur: string): PLBlock => {
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
  res.json({ startDate, endDate, currencies });
}

// ── Balance Sheet as of a date. Equity section includes a synthetic
// "Current period earnings" line (= cumulative income − expense), without
// which Assets = Liabilities + Equity would not hold (no period-close entries
// roll P&L into retained earnings yet). ─────────────────────────────────────
export async function getBalanceSheet(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  await ensureChartSeeded(schoolId);

  const asOf = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : null;

  let agg: AggAccount[];
  try { agg = await aggregateLines(schoolId, { endDate: asOf }); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }

  interface BSAccount { code: string; name: string; amount: number; }
  interface BSBlock {
    currency: string;
    assets: BSAccount[]; liabilities: BSAccount[]; equity: BSAccount[];
    currentEarnings: number;
    totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean;
  }
  const byCur = new Map<string, BSBlock>();
  const block = (cur: string): BSBlock => {
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
  res.json({ asOf, currencies });
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
  res.status(201).json(toCC(data));
}

export async function updateAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  const { name, subtype, isActive } = req.body as { name?: string; subtype?: string | null; isActive?: boolean };

  const { data: before } = await supabase
    .from('chart_of_accounts').select('id, is_system').eq('school_id', schoolId).eq('id', id).single();
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

  const { data, error } = await supabase.from('chart_of_accounts')
    .update(updates).eq('school_id', schoolId).eq('id', id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  const { data: acct } = await supabase
    .from('chart_of_accounts').select('id, is_system').eq('school_id', schoolId).eq('id', id).single();
  if (!acct) { res.status(404).json({ error: 'Account not found' }); return; }
  if ((acct as { is_system: boolean }).is_system) { res.status(409).json({ error: 'System accounts cannot be deleted' }); return; }

  const { data: used } = await supabase
    .from('journal_lines').select('id').eq('school_id', schoolId).eq('account_id', id).limit(1);
  if (used && used.length) { res.status(409).json({ error: 'Account has journal entries — deactivate it instead' }); return; }

  const { error } = await supabase.from('chart_of_accounts').delete().eq('school_id', schoolId).eq('id', id);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  res.status(201).json({ id: result.entryId });
}
