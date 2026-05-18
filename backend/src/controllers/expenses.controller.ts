import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { logAudit } from '../utils/audit';
import { assertPeriodOpen } from '../utils/period';
import { parseCursorParams, buildPageWith, keysetAfter } from '../utils/pagination';

// ── Premium gate ────────────────────────────────────────────────────────
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

// Bumps a date by the given cadence. Returns ISO YYYY-MM-DD.
function bumpDate(dateStr: string, cadence: 'monthly' | 'quarterly' | 'yearly'): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (cadence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (cadence === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// ── CATEGORIES ──────────────────────────────────────────────────────────
export async function listCategories(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('school_id', schoolId)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data ?? []));
}

export async function createCategory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const name = String((req.body?.name ?? '')).trim();
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ school_id: schoolId, name })
    .select()
    .single();
  if (error) {
    if ((error as any).code === '23505') { res.status(409).json({ error: 'A category with that name already exists' }); return; }
    res.status(500).json({ error: error.message }); return;
  }
  await logAudit({ req, entityType: 'expense_category', entityId: String(data.id), action: 'create', after: data, label: data.name });
  res.json(toCC(data));
}

export async function updateCategory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { name, isActive } = req.body as { name?: string; isActive?: boolean };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) { res.status(400).json({ error: 'Name cannot be empty' }); return; }
    updates.name = trimmed;
  }
  if (typeof isActive === 'boolean') updates.is_active = isActive;

  const { data: before } = await supabase.from('expense_categories').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Category not found' }); return; }
  const { data: after, error } = await supabase
    .from('expense_categories')
    .update(updates)
    .eq('id', id).eq('school_id', schoolId)
    .select().single();
  if (error) {
    if ((error as any).code === '23505') { res.status(409).json({ error: 'A category with that name already exists' }); return; }
    res.status(500).json({ error: error.message }); return;
  }
  await logAudit({ req, entityType: 'expense_category', entityId: String(id), action: 'update', before, after, label: after.name });
  res.json(toCC(after));
}

// Hard-delete a category — only allowed if no expenses or templates reference it.
// Otherwise the caller should archive (set is_active = false) instead.
export async function deleteCategory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('expense_categories').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Category not found' }); return; }

  const [{ count: expCount }, { count: tmplCount }] = await Promise.all([
    supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('category_id', id),
    supabase.from('expense_recurring_templates').select('id', { count: 'exact', head: true }).eq('category_id', id),
  ]);
  if ((expCount ?? 0) + (tmplCount ?? 0) > 0) {
    res.status(409).json({ error: 'Category is in use. Archive it instead.' }); return;
  }

  const { error } = await supabase.from('expense_categories').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense_category', entityId: String(id), action: 'delete', before, label: before.name });
  res.json({ success: true });
}

// ── RECURRING TEMPLATES ─────────────────────────────────────────────────
export async function listTemplates(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('expense_recurring_templates')
    .select('*, category:expense_categories(id, name)')
    .eq('school_id', schoolId)
    .order('is_active', { ascending: false })
    .order('next_due_date', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data ?? []));
}

export async function createTemplate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { name, amount, currency, cadence, nextDueDate, categoryId, vendor, notes } = req.body as {
    name?: string; amount?: number; currency?: string; cadence?: 'monthly' | 'quarterly' | 'yearly';
    nextDueDate?: string | null; categoryId?: string | null; vendor?: string | null; notes?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: 'Name is required' }); return; }
  if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) { res.status(400).json({ error: 'Amount must be a non-negative number' }); return; }
  if (!cadence || !['monthly', 'quarterly', 'yearly'].includes(cadence)) {
    res.status(400).json({ error: 'Cadence must be monthly, quarterly, or yearly' }); return;
  }

  const insertRow = {
    school_id: schoolId,
    name: name.trim(),
    amount,
    currency: currency?.trim() || (await getDefaultCurrency(schoolId)),
    cadence,
    next_due_date: nextDueDate || null,
    category_id: categoryId || null,
    vendor: vendor?.trim() || null,
    notes: notes ?? null,
    created_by: req.user!.userId,
  };
  const { data, error } = await supabase.from('expense_recurring_templates').insert(insertRow).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense_template', entityId: String(data.id), action: 'create', after: data, label: data.name });
  res.json(toCC(data));
}

export async function updateTemplate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { name, amount, currency, cadence, nextDueDate, categoryId, vendor, notes, isActive } = req.body as {
    name?: string; amount?: number; currency?: string; cadence?: 'monthly' | 'quarterly' | 'yearly';
    nextDueDate?: string | null; categoryId?: string | null; vendor?: string | null; notes?: string | null; isActive?: boolean;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === 'string') {
    if (!name.trim()) { res.status(400).json({ error: 'Name cannot be empty' }); return; }
    updates.name = name.trim();
  }
  if (typeof amount === 'number') {
    if (!isFinite(amount) || amount < 0) { res.status(400).json({ error: 'Amount must be a non-negative number' }); return; }
    updates.amount = amount;
  }
  if (typeof currency === 'string') updates.currency = currency.trim();
  if (cadence) {
    if (!['monthly', 'quarterly', 'yearly'].includes(cadence)) { res.status(400).json({ error: 'Invalid cadence' }); return; }
    updates.cadence = cadence;
  }
  if (nextDueDate !== undefined) updates.next_due_date = nextDueDate || null;
  if (categoryId !== undefined) updates.category_id = categoryId || null;
  if (vendor !== undefined) updates.vendor = vendor?.trim() || null;
  if (notes !== undefined) updates.notes = notes;
  if (typeof isActive === 'boolean') updates.is_active = isActive;

  const { data: before } = await supabase.from('expense_recurring_templates').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Template not found' }); return; }
  const { data: after, error } = await supabase
    .from('expense_recurring_templates').update(updates)
    .eq('id', id).eq('school_id', schoolId)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense_template', entityId: String(id), action: 'update', before, after, label: after.name });
  res.json(toCC(after));
}

export async function deleteTemplate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('expense_recurring_templates').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Template not found' }); return; }
  const { error } = await supabase.from('expense_recurring_templates').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense_template', entityId: String(id), action: 'delete', before, label: before.name });
  res.json({ success: true });
}

// "Record this period" — create a one-row expense from the template, then bump
// the template's next_due_date forward by the cadence.
export async function recordTemplate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { expenseDate, amount, notes, paymentMethod, taxAmount, taxLabel, paymentAccountId } = req.body as {
    expenseDate?: string; amount?: number; notes?: string | null; paymentMethod?: string | null;
    taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null;
  };
  if (taxAmount !== undefined && (typeof taxAmount !== 'number' || taxAmount < 0)) { res.status(400).json({ error: 'taxAmount must be a non-negative number' }); return; }
  const { data: tmpl } = await supabase.from('expense_recurring_templates').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!tmpl) { res.status(404).json({ error: 'Template not found' }); return; }
  if (!tmpl.is_active) { res.status(409).json({ error: 'Template is archived' }); return; }

  const t = tmpl as Record<string, any>;
  const dateUsed = expenseDate || t.next_due_date || new Date().toISOString().slice(0, 10);
  const amountUsed = (typeof amount === 'number' && isFinite(amount) && amount >= 0) ? amount : Number(t.amount);

  // Block writes into a closed period — same guard as createExpense
  const periodGuard = await assertPeriodOpen(schoolId, [dateUsed]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const { data: expense, error: insertErr } = await supabase.from('expenses').insert({
    school_id: schoolId,
    category_id: t.category_id,
    template_id: t.id,
    name: t.name,
    amount: amountUsed,
    currency: t.currency,
    expense_date: dateUsed,
    vendor: t.vendor,
    payment_method: paymentMethod ?? null,
    notes: notes ?? null,
    tax_amount: typeof taxAmount === 'number' ? taxAmount : 0,
    tax_label: taxLabel ?? null,
    payment_account_id: paymentAccountId ?? null,
    recorded_by: req.user!.userId,
  }).select().single();
  if (insertErr) { res.status(500).json({ error: insertErr.message }); return; }
  await logAudit({ req, entityType: 'expense', entityId: String(expense.id), action: 'create', after: expense, label: expense.name });

  const baseDate = t.next_due_date || dateUsed;
  const newNext = bumpDate(baseDate, t.cadence as 'monthly' | 'quarterly' | 'yearly');
  await supabase.from('expense_recurring_templates')
    .update({ next_due_date: newNext, updated_at: new Date().toISOString() })
    .eq('id', id).eq('school_id', schoolId);

  res.json({ expense: toCC(expense), nextDueDate: newNext });
}

// ── EXPENSES ────────────────────────────────────────────────────────────
export async function listExpenses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { startDate, endDate, categoryId, kind } = req.query as {
    startDate?: string; endDate?: string; categoryId?: string; kind?: 'recurring' | 'one_time' | 'all';
  };
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);

  // Shared filter application — reused by the page query and the whole-set
  // totals query so a page boundary can never change the displayed total.
  const applyFilters = <T extends { gte: any; lte: any; eq: any; not: any; is: any }>(q: T): T => {
    let x: any = q;
    if (startDate) x = x.gte('expense_date', startDate);
    if (endDate) x = x.lte('expense_date', endDate);
    if (categoryId) x = x.eq('category_id', categoryId);
    if (kind === 'recurring') x = x.not('template_id', 'is', null);
    if (kind === 'one_time') x = x.is('template_id', null);
    return x as T;
  };

  // Page: keyset on (expense_date DESC, id DESC). The secondary sort key
  // changed from created_at to id — id is the only unique tiebreak, which
  // keyset pagination requires to avoid skipping/duplicating rows that
  // share an expense_date. Same-day display order is otherwise unchanged.
  let q = applyFilters(
    supabase
      .from('expenses')
      .select('*, category:expense_categories(id, name), template:expense_recurring_templates(id, name, cadence)')
      .eq('school_id', schoolId)
      .is('voided_at', null) as any,
  )
    .order('expense_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(keysetAfter('expense_date', cursor));

  // Whole-set aggregate: a separate, narrow (amount,currency) scan over the
  // exact same filter set. Drives the summary so it stays correct at any
  // scroll depth — per the financial-pagination constraint.
  const aggQ = applyFilters(
    supabase
      .from('expenses')
      .select('amount, currency')
      .eq('school_id', schoolId)
      .is('voided_at', null) as any,
  );

  const [{ data, error }, { data: aggData, error: aggErr }] = await Promise.all([q, aggQ]);
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (aggErr) { res.status(500).json({ error: aggErr.message }); return; }

  const totalsMap = new Map<string, number>();
  for (const r of (aggData ?? []) as any[]) {
    totalsMap.set(r.currency, (totalsMap.get(r.currency) ?? 0) + Number(r.amount || 0));
  }
  const totals = Array.from(totalsMap.entries()).map(([currency, total]) => ({ currency, total }));

  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.expense_date as string,
  );
  res.json({
    data: page.data.map(toCC),
    limit: page.limit,
    nextCursor: page.nextCursor,
    totals,
    count: (aggData ?? []).length,
  });
}

export async function createExpense(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { name, amount, currency, expenseDate, categoryId, vendor, paymentMethod, notes, taxAmount, taxLabel, paymentAccountId } = req.body as {
    name?: string; amount?: number; currency?: string; expenseDate?: string;
    categoryId?: string | null; vendor?: string | null; paymentMethod?: string | null; notes?: string | null;
    taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: 'Name is required' }); return; }
  if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) { res.status(400).json({ error: 'Amount must be a non-negative number' }); return; }
  if (!expenseDate) { res.status(400).json({ error: 'Expense date is required' }); return; }
  if (taxAmount !== undefined && (typeof taxAmount !== 'number' || taxAmount < 0)) { res.status(400).json({ error: 'taxAmount must be a non-negative number' }); return; }

  const periodGuard = await assertPeriodOpen(schoolId, [expenseDate]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const { data, error } = await supabase.from('expenses').insert({
    school_id: schoolId,
    category_id: categoryId || null,
    name: name.trim(),
    amount,
    currency: currency?.trim() || (await getDefaultCurrency(schoolId)),
    expense_date: expenseDate,
    vendor: vendor?.trim() || null,
    payment_method: paymentMethod?.trim() || null,
    notes: notes ?? null,
    tax_amount: typeof taxAmount === 'number' ? taxAmount : 0,
    tax_label: taxLabel ?? null,
    payment_account_id: paymentAccountId ?? null,
    recorded_by: req.user!.userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense', entityId: String(data.id), action: 'create', after: data, label: data.name });
  res.json(toCC(data));
}

export async function updateExpense(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { name, amount, currency, expenseDate, categoryId, vendor, paymentMethod, notes, taxAmount, taxLabel, paymentAccountId } = req.body as {
    name?: string; amount?: number; currency?: string; expenseDate?: string;
    categoryId?: string | null; vendor?: string | null; paymentMethod?: string | null; notes?: string | null;
    taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof name === 'string') {
    if (!name.trim()) { res.status(400).json({ error: 'Name cannot be empty' }); return; }
    updates.name = name.trim();
  }
  if (typeof amount === 'number') {
    if (!isFinite(amount) || amount < 0) { res.status(400).json({ error: 'Amount must be a non-negative number' }); return; }
    updates.amount = amount;
  }
  if (typeof currency === 'string') updates.currency = currency.trim();
  if (typeof expenseDate === 'string' && expenseDate) updates.expense_date = expenseDate;
  if (categoryId !== undefined) updates.category_id = categoryId || null;
  if (vendor !== undefined) updates.vendor = vendor?.trim() || null;
  if (paymentMethod !== undefined) updates.payment_method = paymentMethod?.trim() || null;
  if (notes !== undefined) updates.notes = notes;
  if (taxAmount !== undefined) {
    if (typeof taxAmount !== 'number' || taxAmount < 0) { res.status(400).json({ error: 'taxAmount must be a non-negative number' }); return; }
    updates.tax_amount = taxAmount;
  }
  if (taxLabel !== undefined) updates.tax_label = taxLabel;
  if (paymentAccountId !== undefined) updates.payment_account_id = paymentAccountId;

  const { data: before } = await supabase.from('expenses').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Expense not found' }); return; }
  if ((before as any).voided_at) { res.status(409).json({ error: 'Cannot edit a voided expense — restore it first' }); return; }
  // Block edit if old or new date is in a closed period
  const oldDate = (before as any).expense_date as string | undefined;
  const newDate = typeof expenseDate === 'string' ? expenseDate : undefined;
  const periodGuard = await assertPeriodOpen(schoolId, [oldDate, newDate]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const { data: after, error } = await supabase.from('expenses').update(updates)
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense', entityId: String(id), action: 'update', before, after, label: after.name });
  res.json(toCC(after));
}

export async function voidExpense(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { reason } = req.body as { reason?: string };

  const { data: before } = await supabase.from('expenses').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Expense not found' }); return; }
  if ((before as any).voided_at) { res.status(409).json({ error: 'Already voided' }); return; }
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).expense_date]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const { data: after, error } = await supabase.from('expenses').update({
    voided_at: new Date().toISOString(),
    voided_by: req.user!.userId,
    void_reason: reason?.trim() || null,
  }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense', entityId: String(id), action: 'update', before, after, label: (before as any).name, reason });
  res.json({ success: true });
}

export async function unvoidExpense(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('expenses').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before || !(before as any).voided_at) { res.status(404).json({ error: 'Voided expense not found' }); return; }
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).expense_date]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }
  const { data: after, error } = await supabase.from('expenses').update({
    voided_at: null, voided_by: null, void_reason: null,
  }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'expense', entityId: String(id), action: 'update', before, after, label: (before as any).name });
  res.json({ success: true });
}

export async function listVoidedExpenses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  let q = supabase
    .from('expenses')
    .select('*, category:expense_categories(id, name)')
    .eq('school_id', schoolId)
    .not('voided_at', 'is', null)
    .order('voided_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(keysetAfter('voided_at', cursor));
  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.voided_at as string,
  );
  const voiderIds = Array.from(new Set(page.data.map((e: any) => e.voided_by).filter(Boolean)));
  const { data: users } = voiderIds.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', voiderIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }
  res.json({
    data: page.data.map((e: any) => ({
      ...(toCC(e) as Record<string, unknown>),
      voidedByName: e.voided_by ? nameByUser.get(e.voided_by) ?? null : null,
    })),
    limit: page.limit,
    nextCursor: page.nextCursor,
  });
}
