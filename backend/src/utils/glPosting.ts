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
  expenseFor: (categoryId: string | null | undefined) => string | undefined;
}

// Ensures the chart exists, then returns resolver helpers over it.
async function loadAccounts(schoolId: string): Promise<AccountLookup> {
  await ensureChartSeeded(schoolId);
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('id, code, fee_kind, payment_account_id, expense_category_id')
    .eq('school_id', schoolId)
    .eq('is_active', true);
  const rows = (data ?? []) as Array<{ id: string; code: string; fee_kind: string | null; payment_account_id: string | null; expense_category_id: string | null }>;
  return {
    byCode: (code) => rows.find(r => r.code === code)?.id,
    byFeeKind: (kind) => rows.find(r => r.fee_kind === kind)?.id ?? rows.find(r => r.code === '4090')?.id,
    cashFor: (paId) =>
      (paId ? rows.find(r => r.payment_account_id === paId)?.id : undefined) ?? rows.find(r => r.code === '1000')?.id,
    expenseFor: (catId) =>
      (catId ? rows.find(r => r.expense_category_id === catId)?.id : undefined) ?? rows.find(r => r.code === '5090')?.id,
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

// Refund issued (reverses revenue, cash out): Dr Income(kind) / Cr Cash.
export async function postRefund(o: {
  schoolId: string;
  refundId: string;
  studentId?: string | null;
  amount: number;
  currency: string;
  feeKind?: string | null;
  paymentAccountId?: string | null;
  entryDate: string;
  postedBy?: string | null;
}): Promise<void> {
  if (!(o.amount > 0)) return;
  const acc = await loadAccounts(o.schoolId);
  const income = acc.byFeeKind(o.feeKind || 'tuition');
  const cash = acc.cashFor(o.paymentAccountId);
  if (!income || !cash) { console.error('[gl] refund skipped: income/cash account missing'); return; }
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'refund', sourceId: o.refundId, memo: 'Refund', postedBy: o.postedBy ?? null,
    lines: [
      { accountId: income, debit: o.amount, studentId: o.studentId ?? null },
      { accountId: cash, credit: o.amount, studentId: o.studentId ?? null },
    ],
  });
}

// ── Expenses (cash basis) ────────────────────────────────────────────────

// Expense paid: Dr Expense(category) / Cr Cash. Tax (if any) is folded into the
// expense amount — schools treat vendor tax as part of the cost.
export async function postExpense(o: {
  schoolId: string;
  expenseId: string;
  amount: number;
  currency: string;
  categoryId?: string | null;
  paymentAccountId?: string | null;
  entryDate: string;
  postedBy?: string | null;
  memo?: string | null;
}): Promise<void> {
  if (!(o.amount > 0)) return;
  const acc = await loadAccounts(o.schoolId);
  const expense = acc.expenseFor(o.categoryId);
  const cash = acc.cashFor(o.paymentAccountId);
  if (!expense || !cash) { console.error('[gl] expense skipped: expense/cash account missing'); return; }
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'expense', sourceId: o.expenseId, memo: o.memo ?? 'Expense', postedBy: o.postedBy ?? null,
    lines: [
      { accountId: expense, debit: o.amount },
      { accountId: cash, credit: o.amount },
    ],
  });
}

// ── Salaries (cash basis, with insurance withholding) ──────────────────────

// Salary paid. `amount` is GROSS; insurance is withheld and held as a liability,
// so net cash out = amount - insurance:
//   Dr Salary Expense (gross) / Cr Cash (net) / Cr Insurance Payable (withheld)
export async function postSalary(o: {
  schoolId: string;
  paymentId: string;
  staffId?: string | null;
  amount: number;            // gross
  insuranceAmount?: number;  // withheld
  currency: string;
  paymentAccountId?: string | null;
  entryDate: string;
  postedBy?: string | null;
}): Promise<void> {
  const gross = o.amount;
  if (!(gross > 0)) return;
  const ins = Math.max(0, Math.min(o.insuranceAmount ?? 0, gross));
  const net = round2(gross - ins);
  const acc = await loadAccounts(o.schoolId);
  const salaryExp = acc.byCode('5000');
  const cash = acc.cashFor(o.paymentAccountId);
  const insPayable = acc.byCode('2000');
  if (!salaryExp || !cash || (ins > 0 && !insPayable)) { console.error('[gl] salary skipped: account missing'); return; }
  const lines: PostLine[] = [
    { accountId: salaryExp, debit: gross, staffId: o.staffId ?? null },
    { accountId: cash, credit: net, staffId: o.staffId ?? null },
  ];
  if (ins > 0) lines.push({ accountId: insPayable!, credit: ins, description: 'Insurance withheld', staffId: o.staffId ?? null });
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'salary', sourceId: o.paymentId, memo: 'Salary', postedBy: o.postedBy ?? null, lines,
  });
}

// Insurance held is paid out: Dr Insurance Payable / Cr Cash. Keyed on staff id
// (the payout is a field update on staff_members, not a separate row).
export async function postInsurancePayout(o: {
  schoolId: string;
  staffId: string;
  amount: number;
  currency: string;
  entryDate: string;
  postedBy?: string | null;
}): Promise<void> {
  if (!(o.amount > 0)) return;
  const acc = await loadAccounts(o.schoolId);
  const insPayable = acc.byCode('2000');
  const cash = acc.byCode('1000');
  if (!insPayable || !cash) { console.error('[gl] insurance payout skipped: account missing'); return; }
  await postEntry({
    schoolId: o.schoolId, entryDate: o.entryDate, currency: o.currency,
    source: 'insurance_payout', sourceId: o.staffId, memo: 'Insurance paid out', postedBy: o.postedBy ?? null,
    lines: [
      { accountId: insPayable, debit: o.amount, staffId: o.staffId },
      { accountId: cash, credit: o.amount, staffId: o.staffId },
    ],
  });
}

// ── Void → reversal / unvoid → reinstate (generic, keyed on source row id) ──
// UUIDs are globally unique, so source_id alone identifies the originating
// entry — no need to know its source type. Reversals/reinstatements post on the
// ORIGINAL entry's date, which the controller already verified is in an open
// period; this keeps the net-zero pair inside the same (open) period.

async function findOriginalEntry(schoolId: string, sourceId: string): Promise<{ id: string; currency: string; source: string; entry_date: string } | null> {
  const { data } = await supabase
    .from('journal_entries')
    .select('id, currency, source, entry_date')
    .eq('school_id', schoolId).eq('source_id', sourceId).eq('is_reversal', false)
    .order('entry_no', { ascending: false }).limit(1);
  return (data && data[0]) ? (data[0] as any) : null;
}

async function isReversed(schoolId: string, entryId: string): Promise<boolean> {
  const { data } = await supabase
    .from('journal_entries').select('id').eq('school_id', schoolId).eq('reverses_entry_id', entryId).limit(1);
  return !!(data && data.length);
}

async function entryLines(entryId: string): Promise<PostLine[]> {
  const { data } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit, description, student_id, staff_id')
    .eq('entry_id', entryId);
  return ((data ?? []) as any[]).map(l => ({
    accountId: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    description: l.description, studentId: l.student_id, staffId: l.staff_id,
  }));
}

// Post a reversing entry (swapped debit/credit) for the row's original entry.
export async function reverseEntry(schoolId: string, sourceId: string, opts?: { postedBy?: string | null; memo?: string | null }): Promise<void> {
  try {
    const orig = await findOriginalEntry(schoolId, sourceId);
    if (!orig) return;                       // GL wasn't posted (e.g. unseeded) — nothing to reverse
    if (await isReversed(schoolId, orig.id)) return;
    const lines = await entryLines(orig.id);
    if (!lines.length) return;
    await postEntry({
      schoolId, entryDate: orig.entry_date, currency: orig.currency,
      source: 'reversal', sourceId, isReversal: true, reversesEntryId: orig.id,
      memo: opts?.memo ?? 'Reversal', postedBy: opts?.postedBy ?? null,
      lines: lines.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description, studentId: l.studentId, staffId: l.staffId })),
    });
  } catch (e) { console.error('[gl] reverseEntry threw:', (e as Error).message); }
}

// Re-post the original lines after an unvoid (only if it was actually reversed).
export async function reinstateEntry(schoolId: string, sourceId: string, opts?: { postedBy?: string | null }): Promise<void> {
  try {
    const orig = await findOriginalEntry(schoolId, sourceId);
    if (!orig) return;
    if (!(await isReversed(schoolId, orig.id))) return;  // never voided in GL — nothing to reinstate
    const lines = await entryLines(orig.id);
    if (!lines.length) return;
    await postEntry({
      schoolId, entryDate: orig.entry_date, currency: orig.currency,
      source: orig.source, sourceId, memo: 'Reinstated', postedBy: opts?.postedBy ?? null, lines,
    });
  } catch (e) { console.error('[gl] reinstateEntry threw:', (e as Error).message); }
}
