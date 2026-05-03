import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify } from '../utils/notify';

// ── Premium gate (shares the tuition_fees flag) ────────────────────────

async function ensurePremium(schoolId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase.from('schools').select('features').eq('id', schoolId).single();
  if ((data?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    return { ok: false, status: 403, error: 'Accounting module is not enabled for this school.' };
  }
  return { ok: true };
}

// ── Body shapes ────────────────────────────────────────────────────────

interface StaffBody {
  userId?: string | null;
  fullName?: string;
  position?: string | null;
  salaryAmount?: number;
  currency?: string;
  nextPaymentDate?: string | null;
  isActive?: boolean;
}

interface PaymentBody {
  amount?: number;
  currency?: string;
  paidOn?: string;
  periodLabel?: string | null;
  notes?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function fetchStaffWithLastPayment(schoolId: string): Promise<unknown[]> {
  const { data: staff, error } = await supabase
    .from('staff_members')
    .select('id, school_id, user_id, full_name, position, salary_amount, currency, next_payment_date, is_active, created_at')
    .eq('school_id', schoolId)
    .order('is_active', { ascending: false })
    .order('next_payment_date', { ascending: true, nullsFirst: false })
    .order('full_name');
  if (error) throw new Error(error.message);

  if (!staff || staff.length === 0) return [];

  const ids = (staff as { id: string }[]).map(s => s.id);
  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('staff_id, amount, currency, paid_on, period_label')
    .in('staff_id', ids)
    .order('paid_on', { ascending: false });

  const lastByStaff = new Map<string, { amount: number; currency: string; paidOn: string; periodLabel: string | null }>();
  for (const p of (payments ?? []) as { staff_id: string; amount: number; currency: string; paid_on: string; period_label: string | null }[]) {
    if (!lastByStaff.has(p.staff_id)) {
      lastByStaff.set(p.staff_id, { amount: p.amount, currency: p.currency, paidOn: p.paid_on, periodLabel: p.period_label });
    }
  }

  return (staff as { id: string; user_id: string | null }[]).map(s => {
    const last = lastByStaff.get(s.id) ?? null;
    return { ...toCC(s) as Record<string, unknown>, lastPayment: last };
  });
}

// ── Staff CRUD (admin/accountant RW) ───────────────────────────────────

export async function listStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    res.json(await fetchStaffWithLastPayment(schoolId));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

// Bootstrap data for the Staff tab: list of teachers (so the accountant can
// link a staff row to an existing teacher account).
export async function getStaffSetup(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data: teachers, error } = await supabase
    .from('teachers')
    .select('id, user_id, full_name, subject, users!inner(is_active)')
    .eq('school_id', schoolId)
    .eq('users.is_active', true)
    .order('full_name');
  if (error) { res.status(500).json({ error: error.message }); return; }

  const linkedRes = await supabase
    .from('staff_members')
    .select('user_id')
    .eq('school_id', schoolId)
    .not('user_id', 'is', null);
  const linkedUserIds = new Set(((linkedRes.data ?? []) as { user_id: string }[]).map(r => r.user_id));

  const out = ((teachers ?? []) as { id: string; user_id: string; full_name: string; subject: string | null }[]).map(t => ({
    teacherId: t.id,
    userId: t.user_id,
    fullName: t.full_name,
    subject: t.subject,
    alreadyLinked: linkedUserIds.has(t.user_id),
  }));
  res.json({ teachers: out });
}

export async function createStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { userId, fullName, position, salaryAmount, currency, nextPaymentDate, isActive } = req.body as StaffBody;
  if (!fullName || !fullName.trim()) { res.status(400).json({ error: 'fullName is required' }); return; }
  if (typeof salaryAmount !== 'number' || salaryAmount < 0) { res.status(400).json({ error: 'salaryAmount must be a non-negative number' }); return; }
  if (!currency || currency.length < 1 || currency.length > 8) { res.status(400).json({ error: 'currency is required' }); return; }

  // If linking a user, validate the user belongs to this school
  if (userId) {
    const { data: u } = await supabase.from('users').select('id').eq('id', userId).eq('school_id', schoolId).single();
    if (!u) { res.status(400).json({ error: 'Linked user not found in this school' }); return; }
  }

  const { data, error } = await supabase.from('staff_members').insert({
    school_id: schoolId,
    user_id: userId ?? null,
    full_name: fullName.trim(),
    position: position?.trim() || null,
    salary_amount: salaryAmount,
    currency: currency.toUpperCase(),
    next_payment_date: nextPaymentDate || null,
    is_active: isActive ?? true,
  }).select().single();

  if (error) {
    // Unique-constraint violation when linking a user already on the roster
    if (error.code === '23505') { res.status(409).json({ error: 'This user is already on the staff roster' }); return; }
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(toCC(data));
}

export async function updateStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const body = req.body as StaffBody;

  const upd: Record<string, unknown> = {};
  if ('userId' in body) {
    if (body.userId) {
      const { data: u } = await supabase.from('users').select('id').eq('id', body.userId).eq('school_id', schoolId).single();
      if (!u) { res.status(400).json({ error: 'Linked user not found in this school' }); return; }
    }
    upd.user_id = body.userId ?? null;
  }
  if (typeof body.fullName === 'string' && body.fullName.trim()) upd.full_name = body.fullName.trim();
  if ('position' in body) upd.position = body.position?.trim() || null;
  if (typeof body.salaryAmount === 'number' && body.salaryAmount >= 0) upd.salary_amount = body.salaryAmount;
  if (typeof body.currency === 'string' && body.currency.length >= 1 && body.currency.length <= 8) upd.currency = body.currency.toUpperCase();
  if ('nextPaymentDate' in body) upd.next_payment_date = body.nextPaymentDate || null;
  if (typeof body.isActive === 'boolean') upd.is_active = body.isActive;

  const { error } = await supabase.from('staff_members').update(upd).eq('id', id).eq('school_id', schoolId);
  if (error) {
    if (error.code === '23505') { res.status(409).json({ error: 'This user is already on the staff roster' }); return; }
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true });
}

export async function deleteStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { error } = await supabase.from('staff_members').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

// ── Salary payments ────────────────────────────────────────────────────

export async function listStaffPayments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  // Verify the staff row belongs to this school
  const { data: staff } = await supabase.from('staff_members').select('id').eq('id', id).eq('school_id', schoolId).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const { data, error } = await supabase
    .from('staff_salary_payments')
    .select('id, amount, currency, paid_on, period_label, notes, recorded_by, created_at')
    .eq('staff_id', id)
    .order('paid_on', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data ?? []));
}

export async function recordStaffPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // staff_id
  const { amount, currency, paidOn, periodLabel, notes } = req.body as PaymentBody;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!paidOn) { res.status(400).json({ error: 'paidOn is required' }); return; }

  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, currency')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const finalCurrency = (currency && currency.length >= 1 && currency.length <= 8 ? currency.toUpperCase() : (staff as { currency: string }).currency);

  const { data, error } = await supabase.from('staff_salary_payments').insert({
    school_id: schoolId,
    staff_id: id,
    amount,
    currency: finalCurrency,
    paid_on: paidOn,
    period_label: periodLabel?.trim() || null,
    notes: notes?.trim() || null,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Notify linked teacher (if any) that their salary was recorded
  const linkedUser = (staff as { user_id: string | null }).user_id;
  if (linkedUser) {
    await notify({
      schoolId,
      userId: linkedUser,
      type: 'salary_paid',
      title: 'Salary recorded',
      message: `Salary of ${amount} ${finalCurrency} recorded${periodLabel ? ` for ${periodLabel}` : ''}`,
      relatedId: (data as { id: string }).id,
    });
  }

  res.status(201).json(toCC(data));
}

export async function deleteStaffPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { error } = await supabase.from('staff_salary_payments').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

// ── Manual reminder (admin/accountant only) ────────────────────────────

export async function notifyStaffDue(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, salary_amount, currency, next_payment_date, is_active')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const s = staff as { user_id: string | null; salary_amount: number; currency: string; next_payment_date: string | null; is_active: boolean };
  if (!s.user_id) { res.status(400).json({ error: 'This staff member has no linked account to notify' }); return; }
  if (!s.is_active) { res.status(400).json({ error: 'Cannot notify an inactive staff member' }); return; }

  const dateText = s.next_payment_date ? ` on ${s.next_payment_date}` : ' soon';
  await notify({
    schoolId,
    userId: s.user_id,
    type: 'salary_due_soon',
    title: 'Salary payment due',
    message: `Your salary of ${s.salary_amount} ${s.currency} is due${dateText}. Please visit the accounting office.`,
    relatedId: String(id),
  });

  res.json({ success: true });
}

// ── Teacher self-service: read-only "my salary" ────────────────────────

export async function getMyStaffInfo(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, full_name, position, salary_amount, currency, next_payment_date, is_active, created_at')
    .eq('school_id', schoolId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!staff) { res.json({ staff: null, payments: [] }); return; }

  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('id, amount, currency, paid_on, period_label, notes, created_at')
    .eq('staff_id', (staff as { id: string }).id)
    .order('paid_on', { ascending: false });

  res.json({
    staff: toCC(staff),
    payments: toCC(payments ?? []),
  });
}
