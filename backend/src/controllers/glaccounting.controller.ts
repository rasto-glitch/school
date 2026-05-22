import { Response } from 'express';
// Elevated controller — cross-row aggregation over the general ledger.
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { ensureChartSeeded } from '../utils/glSeed';

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
