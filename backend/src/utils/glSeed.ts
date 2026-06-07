// Chart-of-accounts seeder for the General Ledger (Phase 1).
//
// Idempotent: creates the fixed system accounts plus one asset account per
// payment_account and one expense account per expense_category that doesn't
// already have one. Safe to call before every posting / report read — it only
// inserts what's missing. Gated by the caller (premium check lives upstream).
import { adminDb as supabase } from './db';

type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

interface SeedAccount {
  code: string;
  name: string;
  type: AccType;
  subtype?: string;
  feeKind?: string;
}

// Fixed accounts every school gets. Codes follow the standard numbering
// (1xxx asset / 2xxx liability / 3xxx equity / 4xxx income / 5xxx expense).
// The fee-kind income accounts mirror fee_plans.kind so billing can route by
// kind; 4090 "Other Income" is the fallback for unknown kinds.
const SYSTEM_ACCOUNTS: SeedAccount[] = [
  { code: '1000', name: 'Cash on Hand', type: 'asset', subtype: 'cash' }, // default cash (payments with no account)
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'receivable' },
  { code: '2000', name: 'Insurance Withholding Payable', type: 'liability', subtype: 'payable' },
  { code: '2100', name: 'Tax Payable', type: 'liability', subtype: 'payable' },
  { code: '3000', name: 'Opening Balance Equity', type: 'equity' },
  { code: '3900', name: 'Retained Earnings', type: 'equity' },
  { code: '4000', name: 'Tuition Income', type: 'income', feeKind: 'tuition' },
  { code: '4010', name: 'Transport Income', type: 'income', feeKind: 'transport' },
  { code: '4020', name: 'Lunch Income', type: 'income', feeKind: 'lunch' },
  { code: '4030', name: 'Uniform Income', type: 'income', feeKind: 'uniform' },
  { code: '4040', name: 'Exam Income', type: 'income', feeKind: 'exam' },
  { code: '4050', name: 'Registration Income', type: 'income', feeKind: 'registration' },
  { code: '4090', name: 'Other Income', type: 'income', feeKind: 'other' },
  { code: '4100', name: 'Late Fee Income', type: 'income' },
  { code: '5000', name: 'Salary Expense', type: 'expense' },
  { code: '5010', name: 'Insurance Expense', type: 'expense' },
  { code: '5060', name: 'Bad Debt Expense', type: 'expense' }, // archive-time AR writeoff target
  { code: '5090', name: 'Other Expense', type: 'expense' }, // fallback for uncategorized expenses
];

// Returns a generator that hands out the next unused code at/after `base`,
// reserving each as it goes so a single seed run can't collide with itself.
function coder(used: Set<string>, base: number): () => string {
  let n = base;
  return () => {
    while (used.has(String(n))) n++;
    const c = String(n);
    used.add(c);
    n++;
    return c;
  };
}

export async function ensureChartSeeded(schoolId: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('chart_of_accounts')
      .select('code, payment_account_id, expense_category_id')
      .eq('school_id', schoolId);
    const rows = existing ?? [];

    const usedCodes = new Set<string>(rows.map(r => (r as any).code as string));
    const linkedPa = new Set<string>(rows.filter(r => (r as any).payment_account_id).map(r => (r as any).payment_account_id as string));
    const linkedEc = new Set<string>(rows.filter(r => (r as any).expense_category_id).map(r => (r as any).expense_category_id as string));

    const toInsert: Record<string, unknown>[] = [];

    for (const a of SYSTEM_ACCOUNTS) {
      if (usedCodes.has(a.code)) continue;
      usedCodes.add(a.code);
      toInsert.push({
        school_id: schoolId, code: a.code, name: a.name, type: a.type,
        subtype: a.subtype ?? null, fee_kind: a.feeKind ?? null, is_system: true,
      });
    }

    // Payment accounts → asset accounts (codes 1200+).
    const { data: pas } = await supabase
      .from('payment_accounts').select('id, name, kind').eq('school_id', schoolId);
    const nextAssetCode = coder(usedCodes, 1200);
    for (const pa of (pas ?? []) as any[]) {
      if (linkedPa.has(pa.id)) continue;
      toInsert.push({
        school_id: schoolId, code: nextAssetCode(), name: pa.name, type: 'asset',
        subtype: pa.kind ?? 'cash', payment_account_id: pa.id, is_system: false,
      });
    }

    // Expense categories → expense accounts (codes 5100+).
    const { data: ecs } = await supabase
      .from('expense_categories').select('id, name').eq('school_id', schoolId);
    const nextExpenseCode = coder(usedCodes, 5100);
    for (const ec of (ecs ?? []) as any[]) {
      if (linkedEc.has(ec.id)) continue;
      toInsert.push({
        school_id: schoolId, code: nextExpenseCode(), name: ec.name, type: 'expense',
        expense_category_id: ec.id, is_system: false,
      });
    }

    if (toInsert.length === 0) return;
    // ignoreDuplicates guards the (school_id, code) race when two requests seed
    // at once; the partial unique indexes on the link columns guard the rest.
    const { error } = await supabase
      .from('chart_of_accounts')
      .upsert(toInsert, { onConflict: 'school_id,code', ignoreDuplicates: true });
    if (error) console.error('[gl] chart seed insert failed:', error.message);
  } catch (e) {
    console.error('[gl] ensureChartSeeded threw:', (e as Error).message);
  }
}
