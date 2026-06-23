import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
// Elevated controller — see Phase 0 inventory.
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { logAudit } from '../utils/audit';

// Shared premium gate — accounting upgrades sit under the same tuition_fees flag.
async function ensurePremium(schoolId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase.from('schools').select('features').eq('id', schoolId).single();
  if ((data?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    return { ok: false, status: 403, error: 'Accounting module is not enabled for this school.' };
  }
  return { ok: true };
}

// ── ACCOUNTING PERIODS ────────────────────────────────────────────────────
// A "closed" period prevents create/update/void on any financial row whose
// natural date falls inside the range. Each controller calls
// utils/period#assertPeriodOpen before writing.

export async function listPeriods(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id, period_start, period_end, closed_at, closed_by, reopened_at, reopened_by, reopen_reason, notes, created_at')
    .eq('school_id', schoolId)
    .order('period_start', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Resolve actor names so the UI doesn't need to round-trip
  const ids = Array.from(new Set([
    ...(data ?? []).map((r: any) => r.closed_by).filter(Boolean),
    ...(data ?? []).map((r: any) => r.reopened_by).filter(Boolean),
  ]));
  const { data: users } = ids.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', ids)
    : { data: [] as any[] };
  const nameById = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const n = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (n) nameById.set(u.id, n);
  }

  res.json((data ?? []).map((r: any) => ({
    ...(toCC(r) as Record<string, unknown>),
    closedByName: r.closed_by ? nameById.get(r.closed_by) ?? null : null,
    reopenedByName: r.reopened_by ? nameById.get(r.reopened_by) ?? null : null,
    isClosed: !r.reopened_at,
  })));
}

export async function closePeriod(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { periodStart, periodEnd, notes } = req.body as { periodStart?: string; periodEnd?: string; notes?: string };
  if (!periodStart || !periodEnd) { res.status(400).json({ error: 'periodStart and periodEnd are required (YYYY-MM-DD)' }); return; }
  if (periodEnd < periodStart) { res.status(400).json({ error: 'periodEnd must be on or after periodStart' }); return; }

  // Reject overlap with another open (non-reopened) closed period
  const { data: overlap } = await supabase
    .from('accounting_periods')
    .select('id, period_start, period_end')
    .eq('school_id', schoolId)
    .is('reopened_at', null)
    .lte('period_start', periodEnd)
    .gte('period_end', periodStart)
    .limit(1);
  if (overlap && overlap.length > 0) {
    const o = overlap[0] as any;
    res.status(409).json({ error: `Overlaps with already-closed period ${o.period_start} → ${o.period_end}` });
    return;
  }

  // The table has UNIQUE(school_id, period_start, period_end). If the exact
  // same range was previously closed and reopened, the row still exists with
  // reopened_at set. Re-closing means updating that row instead of inserting
  // a new one — otherwise the insert would fail with a duplicate-key error
  // that surfaces as a raw Postgres message in the UI.
  const { data: existing } = await supabase
    .from('accounting_periods')
    .select('id, reopened_at')
    .eq('school_id', schoolId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();

  if (existing && (existing as any).reopened_at) {
    const { data: reclosed, error: reErr } = await supabase
      .from('accounting_periods')
      .update({
        closed_by: userId,
        closed_at: new Date().toISOString(),
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
        notes: notes ?? null,
      })
      .eq('id', (existing as any).id)
      .eq('school_id', schoolId)
      .select()
      .single();
    if (reErr) { res.status(safeDbErrorStatus(reErr)).json({ error: safeDbErrorMessage(reErr) }); return; }
    await logAudit({ req, entityType: 'accounting_period', entityId: String((existing as any).id), action: 'update', after: reclosed, label: `${periodStart} → ${periodEnd}`, reason: 'Re-closed after reopen' });
    res.status(200).json(toCC(reclosed));
    return;
  }

  const { data, error } = await supabase.from('accounting_periods').insert({
    school_id: schoolId,
    period_start: periodStart,
    period_end: periodEnd,
    closed_by: userId,
    notes: notes ?? null,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'accounting_period', entityId: String(data.id), action: 'create', after: data, label: `${periodStart} → ${periodEnd}` });
  res.status(201).json(toCC(data));
}

export async function reopenPeriod(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  if (!reason) { res.status(400).json({ error: 'reason is required when reopening a closed period' }); return; }

  const { data: before } = await supabase.from('accounting_periods').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Period not found' }); return; }
  if ((before as any).reopened_at) { res.status(409).json({ error: 'Period is already open' }); return; }

  const { data: after, error } = await supabase
    .from('accounting_periods')
    .update({ reopened_at: new Date().toISOString(), reopened_by: userId, reopen_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'accounting_period', entityId: String(id), action: 'update', before, after, reason });
  res.json(toCC(after));
}

// ── PAYMENT ACCOUNTS (cash drawers, bank tills, mobile wallets) ───────────

export async function listPaymentAccounts(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: true });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Compute live balance per account: opening + tuition payments (excluding
  // refunds since refunds reduce cash) − refunds − salaries − expenses.
  // All filtered by voided_at IS NULL and account_id IS NOT NULL.
  const accountIds = (data ?? []).map((a: any) => a.id);
  if (accountIds.length === 0) { res.json([]); return; }

  const [fp, ssp, ex] = await Promise.all([
    supabase.from('fee_payments').select('payment_account_id, paid_amount, amount, is_refund').in('payment_account_id', accountIds).is('voided_at', null),
    supabase.from('staff_salary_payments').select('payment_account_id, paid_amount, amount').in('payment_account_id', accountIds).is('voided_at', null),
    supabase.from('expenses').select('payment_account_id, paid_amount, amount').in('payment_account_id', accountIds).is('voided_at', null),
  ]);

  // paid_amount is the cash that actually moved through the drawer (in the
  // drawer's currency); fall back to amount for any pre-migration row.
  const cashOf = (r: any): number => (r.paid_amount != null ? Number(r.paid_amount) : Number(r.amount));

  const inflowByAcct = new Map<string, number>();
  for (const r of (fp.data ?? []) as any[]) {
    const sign = r.is_refund ? -1 : 1;
    inflowByAcct.set(r.payment_account_id, (inflowByAcct.get(r.payment_account_id) ?? 0) + sign * cashOf(r));
  }
  const outflowByAcct = new Map<string, number>();
  for (const r of (ssp.data ?? []) as any[]) {
    outflowByAcct.set(r.payment_account_id, (outflowByAcct.get(r.payment_account_id) ?? 0) + cashOf(r));
  }
  for (const r of (ex.data ?? []) as any[]) {
    outflowByAcct.set(r.payment_account_id, (outflowByAcct.get(r.payment_account_id) ?? 0) + cashOf(r));
  }

  res.json((data ?? []).map((a: any) => ({
    ...(toCC(a) as Record<string, unknown>),
    balance: Math.round((Number(a.opening_balance) + (inflowByAcct.get(a.id) ?? 0) - (outflowByAcct.get(a.id) ?? 0)) * 100) / 100,
  })));
}

export async function createPaymentAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { name, kind, currency, openingBalance, notes } = req.body as {
    name?: string; kind?: string; currency?: string; openingBalance?: number; notes?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!kind || !['cash', 'bank', 'wallet', 'other'].includes(kind)) { res.status(400).json({ error: 'kind must be cash|bank|wallet|other' }); return; }

  const { data, error } = await supabase.from('payment_accounts').insert({
    school_id: schoolId,
    name: name.trim(),
    kind,
    currency: currency?.trim() || 'USD',
    opening_balance: typeof openingBalance === 'number' ? openingBalance : 0,
    notes: notes ?? null,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'payment_account', entityId: String(data.id), action: 'create', after: data, label: data.name });
  res.status(201).json(toCC(data));
}

export async function updatePaymentAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { name, kind, currency, openingBalance, isActive, notes } = req.body as {
    name?: string; kind?: string; currency?: string; openingBalance?: number; isActive?: boolean; notes?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if (name !== undefined) { if (!name.trim()) { res.status(400).json({ error: 'name cannot be empty' }); return; } updates.name = name.trim(); }
  if (kind !== undefined) { if (!['cash', 'bank', 'wallet', 'other'].includes(kind)) { res.status(400).json({ error: 'invalid kind' }); return; } updates.kind = kind; }
  if (currency !== undefined) updates.currency = currency.trim();
  if (openingBalance !== undefined) updates.opening_balance = openingBalance;
  if (isActive !== undefined) updates.is_active = !!isActive;
  if (notes !== undefined) updates.notes = notes;

  const { data: before } = await supabase.from('payment_accounts').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Account not found' }); return; }

  const { data: after, error } = await supabase.from('payment_accounts').update(updates)
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'payment_account', entityId: String(id), action: 'update', before, after, label: (after as any).name });
  res.json(toCC(after));
}

export async function deletePaymentAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  // Soft delete only — keep FK history intact. Deactivating hides the account from new-entry pickers.
  const { data: before } = await supabase.from('payment_accounts').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Account not found' }); return; }
  const { data: after, error } = await supabase.from('payment_accounts').update({ is_active: false })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'payment_account', entityId: String(id), action: 'update', before, after, label: (before as any).name, reason: 'Deactivated' });
  res.json({ success: true });
}

// ── FX RATES (multi-currency rollup) ──────────────────────────────────────

export async function listFxRates(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('fx_rates')
    .select('*')
    .eq('school_id', schoolId)
    .order('effective_from', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data ?? []));
}

export async function setFxRate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { fromCurrency, toCurrency, rate, effectiveFrom } = req.body as {
    fromCurrency?: string; toCurrency?: string; rate?: number; effectiveFrom?: string;
  };
  if (!fromCurrency || !toCurrency) { res.status(400).json({ error: 'fromCurrency and toCurrency are required' }); return; }
  if (fromCurrency === toCurrency) { res.status(400).json({ error: 'fromCurrency and toCurrency must differ' }); return; }
  if (typeof rate !== 'number' || rate <= 0) { res.status(400).json({ error: 'rate must be a positive number' }); return; }

  const effective = effectiveFrom || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('fx_rates').upsert({
    school_id: schoolId,
    from_currency: fromCurrency.toUpperCase(),
    to_currency: toCurrency.toUpperCase(),
    rate,
    effective_from: effective,
  }, { onConflict: 'school_id,from_currency,to_currency,effective_from' }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'fx_rate', entityId: String(data.id), action: 'create', after: data, label: `${fromCurrency}→${toCurrency} @ ${effective}` });
  res.status(201).json(toCC(data));
}

export async function deleteFxRate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('fx_rates').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'FX rate not found' }); return; }
  const { error } = await supabase.from('fx_rates').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'fx_rate', entityId: String(id), action: 'delete', before });
  res.json({ success: true });
}
