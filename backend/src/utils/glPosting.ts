// General Ledger posting layer (Phase 1).
//
// Translates operational money events into balanced double-entry journal
// entries. Posting is BEST-EFFORT by design — a posting failure is logged but
// never blocks the user-facing mutation (same philosophy as logAudit). The
// actual insert is atomic via the gl_post_entry RPC, so a failure leaves no
// half-written entry behind.
//
// Phase 1 covers the revenue cycle:
//   - tuition billing  →  Dr Accounts Receivable / Cr Income(kind)   (accrual)
//   - tuition payment  →  Dr Cash / Cr Accounts Receivable           (settles AR)
//
// Overpayments simply drive AR to a credit balance (the agreed advance model);
// no Unearned Revenue account in Phase 1.
import { adminDb as supabase } from './db';
import { ensureChartSeeded } from './glSeed';

export interface PostLine {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  studentId?: string | null;
  staffId?: string | null;
}

export interface PostEntryOpts {
  schoolId: string;
  entryDate: string;          // YYYY-MM-DD
  currency: string;           // single currency per entry
  source: string;
  sourceId?: string | null;
  memo?: string | null;
  postedBy?: string | null;
  isReversal?: boolean;
  reversesEntryId?: string | null;
  lines: PostLine[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Low-level post. Returns the new entry id, or null on failure (logged).
export async function postEntry(opts: PostEntryOpts): Promise<string | null> {
  try {
    const totalDebit = round2(opts.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = round2(opts.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    if (totalDebit !== totalCredit) {
      console.error(`[gl] refusing unbalanced ${opts.source} entry: debit ${totalDebit} != credit ${totalCredit}`);
      return null;
    }
    if (totalDebit === 0) return null; // nothing to record

    const { data, error } = await supabase.rpc('gl_post_entry', {
      p_school_id: opts.schoolId,
      p_entry_date: opts.entryDate,
      p_currency: opts.currency,
      p_source: opts.source,
      p_source_id: opts.sourceId ?? null,
      p_memo: opts.memo ?? null,
      p_posted_by: opts.postedBy ?? null,
      p_is_reversal: opts.isReversal ?? false,
      p_reverses_entry_id: opts.reversesEntryId ?? null,
      p_lines: opts.lines.map(l => ({
        account_id: l.accountId,
        debit: round2(l.debit ?? 0),
        credit: round2(l.credit ?? 0),
        description: l.description ?? null,
        student_id: l.studentId ?? null,
        staff_id: l.staffId ?? null,
      })),
    });
    if (error) { console.error(`[gl] post ${opts.source} failed:`, error.message); return null; }
    return (data as string) ?? null;
  } catch (e) {
    console.error('[gl] postEntry threw:', (e as Error).message);
    return null;
  }
}

interface AccountLookup {
  byCode: (code: string) => string | undefined;
  byFeeKind: (kind: string) => string | undefined;
  cashFor: (paymentAccountId: string | null | undefined) => string | undefined;
}

// Ensures the chart exists, then returns resolver helpers over it.
async function loadAccounts(schoolId: string): Promise<AccountLookup> {
  await ensureChartSeeded(schoolId);
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('id, code, fee_kind, payment_account_id')
    .eq('school_id', schoolId)
    .eq('is_active', true);
  const rows = (data ?? []) as Array<{ id: string; code: string; fee_kind: string | null; payment_account_id: string | null }>;
  return {
    byCode: (code) => rows.find(r => r.code === code)?.id,
    byFeeKind: (kind) => rows.find(r => r.fee_kind === kind)?.id ?? rows.find(r => r.code === '4090')?.id,
    cashFor: (paId) =>
      (paId ? rows.find(r => r.payment_account_id === paId)?.id : undefined) ?? rows.find(r => r.code === '1000')?.id,
  };
}

// ── Revenue cycle ──────────────────────────────────────────────────────────

// Tuition billed (accrual): Dr Accounts Receivable / Cr Income(kind).
export async function postTuitionBilling(o: {
  schoolId: string;
  studentFeeId: string;
  studentId?: string | null;
  amount: number;
  currency: string;
  feeKind?: string | null;
  entryDate: string;
  postedBy?: string | null;
}): Promise<void> {
  if (!(o.amount > 0)) return;
  const acc = await loadAccounts(o.schoolId);
  const ar = acc.byCode('1100');
  const income = acc.byFeeKind(o.feeKind || 'tuition');
  if (!ar || !income) { console.error('[gl] billing skipped: AR/income account missing'); return; }
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'tuition_billing', sourceId: o.studentFeeId, memo: 'Tuition billed', postedBy: o.postedBy ?? null,
    lines: [
      { accountId: ar, debit: o.amount, description: 'Accounts receivable', studentId: o.studentId ?? null },
      { accountId: income, credit: o.amount, studentId: o.studentId ?? null },
    ],
  });
}

// Tuition payment received: Dr Cash / Cr Accounts Receivable.
export async function postTuitionPayment(o: {
  schoolId: string;
  paymentId: string;
  studentId?: string | null;
  amount: number;
  currency: string;
  paymentAccountId?: string | null;
  entryDate: string;
  postedBy?: string | null;
}): Promise<void> {
  if (!(o.amount > 0)) return;
  const acc = await loadAccounts(o.schoolId);
  const cash = acc.cashFor(o.paymentAccountId);
  const ar = acc.byCode('1100');
  if (!cash || !ar) { console.error('[gl] payment skipped: cash/AR account missing'); return; }
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'fee_payment', sourceId: o.paymentId, memo: 'Tuition payment', postedBy: o.postedBy ?? null,
    lines: [
      { accountId: cash, debit: o.amount, studentId: o.studentId ?? null },
      { accountId: ar, credit: o.amount, description: 'Settle receivable', studentId: o.studentId ?? null },
    ],
  });
}
