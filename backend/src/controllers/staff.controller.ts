import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
// Elevated controller — see Phase 0 inventory.
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { streamStaffSalaryPdf, buildStaffSalaryXlsx, type StaffSalaryExportData } from '../utils/staffSalaryExport';
import { logAudit } from '../utils/audit';
import { assertPeriodOpen } from '../utils/period';
import { hasArchiveFeature, normalizeArchiveReason, resolveEmployeeArchiveId } from '../utils/employeeArchive';
import { parseCursorParams, buildPageWith, keysetAfter } from '../utils/pagination';

// Snapshot a voided staff member into the unified archived_employees table
// (role='staff'). Unlike teacher/driver archive, the staff_members row is
// NOT deleted — it stays soft-voided so staff_salary_payments and accounting
// period integrity survive. This archive row is the self-contained HR record
// (personal + employment + salary/insurance history), intentionally
// duplicating the accounting ledger. Insert-only: no users-row delete (staff
// often have no account, and a linked account may be shared).
async function snapshotStaffArchive(
  schoolId: string,
  staff: Record<string, any>,
  rawReason: unknown,
  departureDate: string,
  actor: { id: string; name: string; role: string },
): Promise<{ ok: true; archiveId: string } | { ok: false; error: string }> {
  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('amount, currency, paid_on, period_label, notes, insurance_amount, insurance_percentage')
    .eq('staff_id', staff.id).eq('school_id', schoolId).is('voided_at', null)
    .order('paid_on', { ascending: true });

  let account: Record<string, unknown> | null = null;
  if (staff.user_id) {
    const { data: u } = await supabase
      .from('users')
      .select('id, username, email, role, first_name, last_name, phone, profile_picture, is_active, password_changed_at, created_at')
      .eq('id', staff.user_id).eq('school_id', schoolId).single();
    account = (u as Record<string, unknown> | null) ?? null;
  }

  const insuranceHeld = await sumInsuranceHeld(staff.id, staff.currency);
  const paymentHistory = (payments ?? []).map((p: any) => ({
    amount: p.amount, currency: p.currency, paidOn: p.paid_on,
    periodLabel: p.period_label ?? null, notes: p.notes ?? null,
    insuranceAmount: p.insurance_amount ?? 0, insurancePercentage: p.insurance_percentage ?? null,
  }));

  const { data, error } = await supabase
    .from('archived_employees')
    .insert({
      school_id: schoolId,
      original_employee_id: staff.id,
      role: 'staff',
      full_name: staff.full_name,
      phone_number: (account?.phone as string | null) ?? null,
      email: (account?.email as string | null) ?? null,
      profile_picture: (account?.profile_picture as string | null) ?? null,
      position: staff.position ?? null,
      hire_date: staff.created_at ? String(staff.created_at).split('T')[0] : null,
      departure_date: departureDate,
      reason: normalizeArchiveReason(rawReason),
      account: account ?? {},
      employment: {
        salaryAmount: staff.salary_amount,
        currency: staff.currency,
        position: staff.position ?? null,
        nextPaymentDate: staff.next_payment_date ?? null,
        insurancePercentage: staff.insurance_percentage ?? null,
        insuranceHeld,
        insurancePaidOut: staff.insurance_paid_out ?? false,
        insurancePaidOutAt: staff.insurance_paid_out_at ?? null,
        insurancePaidOutAmount: staff.insurance_paid_out_amount ?? null,
        insurancePaidOutCurrency: staff.insurance_paid_out_currency ?? null,
        insurancePaidOutNotes: staff.insurance_paid_out_notes ?? null,
      },
      payment_history: paymentHistory,
      archived_by: actor.id,
      archived_by_name: actor.name,
      archived_by_role: actor.role,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: safeDbErrorMessage(error) };
  return { ok: true, archiveId: (data as { id: string }).id };
}

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
  insurancePercentage?: number | null;
  previousArchiveId?: string | null;
}

interface PaymentBody {
  amount?: number;
  currency?: string;
  paidOn?: string;
  periodLabel?: string | null;
  notes?: string | null;
  insuranceAmount?: number | null;
  insurancePercentage?: number | null;
  taxAmount?: number;
  taxLabel?: string | null;
  paymentAccountId?: string | null;
}

interface InsurancePayoutBody {
  paidOn?: string;
  amount?: number;
  currency?: string;
  notes?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

interface RawStaffRow {
  id: string;
  school_id: string;
  user_id: string | null;
  full_name: string;
  position: string | null;
  salary_amount: number;
  currency: string;
  next_payment_date: string | null;
  is_active: boolean;
  insurance_percentage: number | null;
  insurance_paid_out: boolean;
  insurance_paid_out_at: string | null;
  insurance_paid_out_amount: number | null;
  insurance_paid_out_currency: string | null;
  insurance_paid_out_notes: string | null;
  created_at: string;
  users?: { is_active: boolean } | { is_active: boolean }[] | null;
}

function userIsActive(joined: RawStaffRow['users']): boolean | null {
  if (!joined) return null;
  if (Array.isArray(joined)) return joined[0]?.is_active ?? null;
  return joined.is_active;
}

async function fetchStaffWithLastPayment(schoolId: string): Promise<{ active: unknown[]; archived: unknown[] }> {
  const { data: staff, error } = await supabase
    .from('staff_members')
    .select('id, school_id, user_id, full_name, position, salary_amount, currency, next_payment_date, is_active, insurance_percentage, insurance_paid_out, insurance_paid_out_at, insurance_paid_out_amount, insurance_paid_out_currency, insurance_paid_out_notes, created_at, users!staff_members_user_id_fkey(is_active)')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .order('is_active', { ascending: false })
    .order('next_payment_date', { ascending: true, nullsFirst: false })
    .order('full_name');
  if (error) throw new Error(error.message);

  if (!staff || staff.length === 0) return { active: [], archived: [] };

  const rows = staff as RawStaffRow[];
  const ids = rows.map(s => s.id);
  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('staff_id, amount, currency, paid_on, period_label, insurance_amount')
    .in('staff_id', ids)
    .is('voided_at', null)
    .order('paid_on', { ascending: false });

  const lastByStaff = new Map<string, { amount: number; currency: string; paidOn: string; periodLabel: string | null; insuranceAmount: number }>();
  // Total insurance withheld per staff, keyed by currency for safety
  const insuranceByStaff = new Map<string, Map<string, number>>();
  for (const p of (payments ?? []) as { staff_id: string; amount: number; currency: string; paid_on: string; period_label: string | null; insurance_amount: number }[]) {
    if (!lastByStaff.has(p.staff_id)) {
      lastByStaff.set(p.staff_id, { amount: p.amount, currency: p.currency, paidOn: p.paid_on, periodLabel: p.period_label, insuranceAmount: Number(p.insurance_amount) || 0 });
    }
    const ins = Number(p.insurance_amount) || 0;
    if (ins > 0) {
      let perCur = insuranceByStaff.get(p.staff_id);
      if (!perCur) { perCur = new Map(); insuranceByStaff.set(p.staff_id, perCur); }
      perCur.set(p.currency, (perCur.get(p.currency) ?? 0) + ins);
    }
  }

  const active: unknown[] = [];
  const archived: unknown[] = [];

  for (const s of rows) {
    const userActive = s.user_id ? (userIsActive(s.users) ?? false) : null;
    const effectiveActive = s.is_active && (userActive === null || userActive === true);
    const archiveReason = !s.is_active
      ? 'Deactivated by accounting'
      : (userActive === false ? 'Account deactivated' : null);
    const last = lastByStaff.get(s.id) ?? null;
    // Pick insurance total in the staff's primary currency (most common case)
    const perCur = insuranceByStaff.get(s.id);
    const insuranceHeldTotal = perCur ? (perCur.get(s.currency) ?? 0) : 0;
    const insuranceHeldByCurrency = perCur
      ? Array.from(perCur.entries()).map(([currency, amount]) => ({ currency, amount }))
      : [];
    const enriched = {
      ...(toCC(s) as Record<string, unknown>),
      userIsActive: userActive,
      effectiveActive,
      archiveReason,
      lastPayment: last,
      insuranceHeldTotal,
      insuranceHeldByCurrency,
    };
    // Strip the JOIN-only field
    delete (enriched as Record<string, unknown>).users;
    if (effectiveActive) active.push(enriched);
    else archived.push(enriched);
  }

  return { active, archived };
}

// ── Staff CRUD (admin/accountant RW) ───────────────────────────────────

export async function listStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  try {
    const { active, archived } = await fetchStaffWithLastPayment(schoolId);
    const status = String(req.query.status ?? 'active').toLowerCase();
    if (status === 'archived') { res.json(archived); return; }
    if (status === 'all') { res.json([...active, ...archived]); return; }
    res.json(active);
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
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const linkedRes = await supabase
    .from('staff_members')
    .select('user_id')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .not('user_id', 'is', null);
  const linkedUserIds = new Set(((linkedRes.data ?? []) as { user_id: string }[]).map(r => r.user_id));

  const out = ((teachers ?? []) as { id: string; user_id: string; full_name: string; subject: string | null }[]).map(t => ({
    teacherId: t.id,
    userId: t.user_id,
    fullName: t.full_name,
    subject: t.subject,
    alreadyLinked: linkedUserIds.has(t.user_id),
  }));

  // Supervisors have no profile table — link the staff/salary record
  // directly to the users row (createStaff already accepts any same-school
  // userId). Surface active, not-yet-linked supervisors here.
  const { data: supervisorUsers, error: supErr } = await supabase
    .from('users')
    .select('id, first_name, last_name')
    .eq('school_id', schoolId)
    .eq('role', 'supervisor')
    .eq('is_active', true)
    .order('first_name');
  if (supErr) { res.status(safeDbErrorStatus(supErr)).json({ error: safeDbErrorMessage(supErr) }); return; }

  const supervisors = ((supervisorUsers ?? []) as { id: string; first_name: string; last_name: string }[]).map(u => ({
    userId: u.id,
    fullName: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(),
    alreadyLinked: linkedUserIds.has(u.id),
  }));

  // Admins are payroll-eligible too (Employees → Administration). Same
  // pattern: no profile table, link the salary record to the users row.
  const { data: adminUsers, error: admErr } = await supabase
    .from('users')
    .select('id, first_name, last_name')
    .eq('school_id', schoolId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .order('first_name');
  if (admErr) { res.status(safeDbErrorStatus(admErr)).json({ error: safeDbErrorMessage(admErr) }); return; }

  const admins = ((adminUsers ?? []) as { id: string; first_name: string; last_name: string }[]).map(u => ({
    userId: u.id,
    fullName: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(),
    alreadyLinked: linkedUserIds.has(u.id),
  }));

  res.json({ teachers: out, supervisors, admins });
}

export async function createStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { userId, fullName, position, salaryAmount, currency, nextPaymentDate, isActive, insurancePercentage, previousArchiveId } = req.body as StaffBody;
  if (!fullName || !fullName.trim()) { res.status(400).json({ error: 'fullName is required' }); return; }
  if (typeof salaryAmount !== 'number' || salaryAmount < 0) { res.status(400).json({ error: 'salaryAmount must be a non-negative number' }); return; }
  if (!currency || currency.length < 1 || currency.length > 8) { res.status(400).json({ error: 'currency is required' }); return; }

  let insurancePct: number | null = null;
  if (insurancePercentage !== undefined && insurancePercentage !== null) {
    if (typeof insurancePercentage !== 'number' || insurancePercentage < 0 || insurancePercentage > 100) {
      res.status(400).json({ error: 'insurancePercentage must be between 0 and 100' });
      return;
    }
    insurancePct = insurancePercentage;
  }

  // If linking a user, validate the user belongs to this school
  if (userId) {
    const { data: u } = await supabase.from('users').select('id').eq('id', userId).eq('school_id', schoolId).single();
    if (!u) { res.status(400).json({ error: 'Linked user not found in this school' }); return; }
  }

  const prevArchiveId = await resolveEmployeeArchiveId(previousArchiveId, schoolId, 'staff');

  const { data, error } = await supabase.from('staff_members').insert({
    school_id: schoolId,
    user_id: userId ?? null,
    full_name: fullName.trim(),
    position: position?.trim() || null,
    salary_amount: salaryAmount,
    currency: currency.toUpperCase(),
    next_payment_date: nextPaymentDate || null,
    is_active: isActive ?? true,
    insurance_percentage: insurancePct,
    previous_archive_id: prevArchiveId,
  }).select().single();

  if (error) {
    // Unique-constraint violation when linking a user already on the roster
    if (error.code === '23505') { res.status(409).json({ error: 'This user is already on the staff roster' }); return; }
    res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) });
    return;
  }

  await logAudit({ req, entityType: 'staff_member', entityId: data.id, action: 'create', after: data, label: data.full_name });
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
  if ('insurancePercentage' in body) {
    if (body.insurancePercentage === null || body.insurancePercentage === undefined) {
      upd.insurance_percentage = null;
    } else if (typeof body.insurancePercentage === 'number' && body.insurancePercentage >= 0 && body.insurancePercentage <= 100) {
      upd.insurance_percentage = body.insurancePercentage;
    } else {
      res.status(400).json({ error: 'insurancePercentage must be between 0 and 100' });
      return;
    }
  }

  const { data: before } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const { error } = await supabase.from('staff_members').update(upd).eq('id', id).eq('school_id', schoolId);
  if (error) {
    if (error.code === '23505') { res.status(409).json({ error: 'This user is already on the staff roster' }); return; }
    res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) });
    return;
  }
  const { data: after } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).single();
  await logAudit({ req, entityType: 'staff_member', entityId: String(id), action: 'update', before: before || undefined, after: after || undefined, label: (after as { full_name?: string } | null)?.full_name });
  res.json({ success: true });
}

export async function deleteStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  const { data: before } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Staff member not found' }); return; }
  const { data: after, error } = await supabase
    .from('staff_members')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'staff_member', entityId: String(id), action: 'update', before, after, label: (before as { full_name?: string }).full_name, reason: reason ?? undefined });

  // HR archive entry (additive — the soft-void above is the accounting
  // source of truth). Best-effort: a snapshot failure must not undo the
  // committed void, so we report it without failing the request.
  let archived: { archived: true; archiveId: string } | { archived: false } = { archived: false };
  if (await hasArchiveFeature(schoolId)) {
    const departureDate = (req.body?.departureDate as string | undefined) || new Date().toISOString().split('T')[0];
    const snap = await snapshotStaffArchive(schoolId, before as Record<string, any>, reason, departureDate, { id: userId, name: req.user!.username, role: req.user!.role });
    if (snap.ok) archived = { archived: true, archiveId: snap.archiveId };
    else console.error(`[staff archive] snapshot failed for staff ${id}: ${snap.error}`);
  }
  res.json({ success: true, ...archived });
}

export async function unvoidStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before || !(before as any).voided_at) { res.status(404).json({ error: 'Voided staff member not found' }); return; }
  const { data: after, error } = await supabase
    .from('staff_members')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'staff_member', entityId: String(id), action: 'update', before, after, label: (before as { full_name?: string }).full_name });
  res.json({ success: true });
}

export async function listVoidedStaff(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  let q = supabase
    .from('staff_members')
    .select('id, full_name, position, salary_amount, currency, voided_at, voided_by, void_reason')
    .eq('school_id', schoolId)
    .not('voided_at', 'is', null)
    .order('voided_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(keysetAfter('voided_at', cursor));
  const { data, error } = await q;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.voided_at as string,
  );
  const voiderIds = Array.from(new Set(page.data.map((p: any) => p.voided_by).filter(Boolean)));
  const { data: users } = voiderIds.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', voiderIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }
  res.json({
    data: page.data.map((p: any) => ({
      ...(toCC(p) as Record<string, unknown>),
      voidedByName: p.voided_by ? nameByUser.get(p.voided_by) ?? null : null,
    })),
    limit: page.limit,
    nextCursor: page.nextCursor,
  });
}

// ── Salary payments ────────────────────────────────────────────────────

export async function listStaffPayments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  // Verify the staff row belongs to this school
  const { data: staff } = await supabase.from('staff_members').select('id').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);

  // Page: keyset on (paid_on DESC, id DESC). id is the unique tiebreak that
  // keyset pagination requires — many salary payments share a paid_on.
  let q = supabase
    .from('staff_salary_payments')
    .select('id, amount, currency, paid_on, period_label, notes, insurance_amount, insurance_percentage, recorded_by, created_at')
    .eq('staff_id', id)
    .is('voided_at', null)
    .order('paid_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(keysetAfter('paid_on', cursor));

  // Whole-set totals per currency (gross / insurance / net). The history
  // modal's summary must reflect ALL payments, not the current page — a
  // page boundary must never change a financial figure.
  const aggQ = supabase
    .from('staff_salary_payments')
    .select('amount, currency, insurance_amount')
    .eq('staff_id', id)
    .is('voided_at', null);

  const [{ data, error }, { data: aggData, error: aggErr }] = await Promise.all([q, aggQ]);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (aggErr) { res.status(safeDbErrorStatus(aggErr)).json({ error: safeDbErrorMessage(aggErr) }); return; }

  const tMap = new Map<string, { currency: string; gross: number; insurance: number; net: number; count: number }>();
  for (const r of (aggData ?? []) as any[]) {
    const cur = r.currency as string;
    let t = tMap.get(cur);
    if (!t) { t = { currency: cur, gross: 0, insurance: 0, net: 0, count: 0 }; tMap.set(cur, t); }
    t.gross += Number(r.amount) || 0;
    t.insurance += Number(r.insurance_amount) || 0;
    t.net = Math.round((t.gross - t.insurance) * 100) / 100;
    t.count += 1;
  }

  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.paid_on as string,
  );
  res.json({
    data: page.data.map(toCC),
    limit: page.limit,
    nextCursor: page.nextCursor,
    totals: Array.from(tMap.values()),
    count: (aggData ?? []).length,
  });
}

export async function recordStaffPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // staff_id
  const { amount, currency, paidOn, periodLabel, notes, insuranceAmount, insurancePercentage, taxAmount, taxLabel, paymentAccountId } = req.body as PaymentBody;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!paidOn) { res.status(400).json({ error: 'paidOn is required' }); return; }
  if (taxAmount !== undefined && (typeof taxAmount !== 'number' || taxAmount < 0)) { res.status(400).json({ error: 'taxAmount must be a non-negative number' }); return; }

  const periodGuard = await assertPeriodOpen(schoolId, [paidOn]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, currency, insurance_percentage')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const staffRow = staff as { user_id: string | null; full_name: string; currency: string; insurance_percentage: number | null };
  const finalCurrency = (currency && currency.length >= 1 && currency.length <= 8 ? currency.toUpperCase() : staffRow.currency);

  // Resolve insurance for this payment.
  // Default behaviour: snapshot the staff's current % and compute insurance = round(amount * pct / 100, 2).
  // The client may override either the percentage or the absolute amount per payment.
  let insPct: number | null = staffRow.insurance_percentage;
  if (insurancePercentage !== undefined) {
    if (insurancePercentage === null) insPct = null;
    else if (typeof insurancePercentage !== 'number' || insurancePercentage < 0 || insurancePercentage > 100) {
      res.status(400).json({ error: 'insurancePercentage must be between 0 and 100' });
      return;
    } else insPct = insurancePercentage;
  }

  let insAmt: number;
  if (insuranceAmount !== undefined && insuranceAmount !== null) {
    if (typeof insuranceAmount !== 'number' || insuranceAmount < 0) {
      res.status(400).json({ error: 'insuranceAmount must be non-negative' });
      return;
    }
    if (insuranceAmount > amount) {
      res.status(400).json({ error: 'insuranceAmount cannot exceed the payment amount' });
      return;
    }
    insAmt = Math.round(insuranceAmount * 100) / 100;
  } else if (insPct !== null && insPct > 0) {
    insAmt = Math.round((amount * insPct) / 100 * 100) / 100;
  } else {
    insAmt = 0;
  }

  const { data, error } = await supabase.from('staff_salary_payments').insert({
    school_id: schoolId,
    staff_id: id,
    amount,
    currency: finalCurrency,
    paid_on: paidOn,
    period_label: periodLabel?.trim() || null,
    notes: notes?.trim() || null,
    insurance_amount: insAmt,
    insurance_percentage: insPct,
    tax_amount: typeof taxAmount === 'number' ? taxAmount : 0,
    tax_label: taxLabel ?? null,
    payment_account_id: paymentAccountId ?? null,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({ req, entityType: 'staff_salary_payment', entityId: (data as { id: string }).id, action: 'create', after: data as Record<string, unknown>, label: staffRow.full_name });

  // Notify linked teacher (if any) that their salary was recorded
  const linkedUser = staffRow.user_id;
  if (linkedUser) {
    const netPaid = Math.round((amount - insAmt) * 100) / 100;
    const insLine = insAmt > 0 ? ` (insurance withheld: ${insAmt} ${finalCurrency}; net: ${netPaid} ${finalCurrency})` : '';
    await notify({
      schoolId,
      userId: linkedUser,
      type: 'salary_paid',
      title: 'Salary recorded',
      message: `Salary of ${amount} ${finalCurrency} recorded${periodLabel ? ` for ${periodLabel}` : ''}${insLine}`,
      relatedId: (data as { id: string }).id,
    });
  }

  res.status(201).json(toCC(data));
}

export async function deleteStaffPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  const { data: before } = await supabase
    .from('staff_salary_payments')
    .select('*, staff_members(full_name)')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Payment not found' }); return; }
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).paid_on]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }
  const { data: after, error } = await supabase
    .from('staff_salary_payments')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const label = (before as { staff_members?: { full_name?: string } }).staff_members?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.staff_members;
  await logAudit({ req, entityType: 'staff_salary_payment', entityId: String(id), action: 'update', before: beforeRow, after, label, reason: reason ?? undefined });
  res.json({ success: true });
}

export async function unvoidStaffPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase
    .from('staff_salary_payments')
    .select('*, staff_members(full_name)')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!before || !(before as any).voided_at) { res.status(404).json({ error: 'Voided payment not found' }); return; }
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).paid_on]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }
  const { data: after, error } = await supabase
    .from('staff_salary_payments')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const label = (before as { staff_members?: { full_name?: string } }).staff_members?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.staff_members;
  await logAudit({ req, entityType: 'staff_salary_payment', entityId: String(id), action: 'update', before: beforeRow, after, label });
  res.json({ success: true });
}

export async function listVoidedStaffPayments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  let q = supabase
    .from('staff_salary_payments')
    .select('id, amount, currency, paid_on, period_label, notes, insurance_amount, voided_at, voided_by, void_reason, staff_id, staff_members(full_name)')
    .eq('school_id', schoolId)
    .not('voided_at', 'is', null)
    .order('voided_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.or(keysetAfter('voided_at', cursor));
  const { data, error } = await q;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.voided_at as string,
  );
  const voiderIds = Array.from(new Set(page.data.map((p: any) => p.voided_by).filter(Boolean)));
  const { data: users } = voiderIds.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', voiderIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }
  res.json({
    data: page.data.map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      currency: p.currency,
      paidOn: p.paid_on,
      periodLabel: p.period_label,
      notes: p.notes,
      insuranceAmount: Number(p.insurance_amount) || 0,
      voidedAt: p.voided_at,
      voidReason: p.void_reason,
      voidedByName: p.voided_by ? nameByUser.get(p.voided_by) ?? null : null,
      staffId: p.staff_id,
      staffName: p.staff_members?.full_name ?? null,
    })),
    limit: page.limit,
    nextCursor: page.nextCursor,
  });
}

// ── Insurance payout (admin/accountant only, archived staff) ──────────

async function sumInsuranceHeld(staffId: string, currency: string): Promise<number> {
  const { data } = await supabase
    .from('staff_salary_payments')
    .select('insurance_amount, currency')
    .eq('staff_id', staffId)
    .is('voided_at', null);
  let total = 0;
  for (const r of (data ?? []) as { insurance_amount: number; currency: string }[]) {
    if (r.currency === currency) total += Number(r.insurance_amount) || 0;
  }
  return Math.round(total * 100) / 100;
}

export async function markStaffInsurancePaid(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  const body = req.body as InsurancePayoutBody;

  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, currency, insurance_paid_out')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const s = staff as { user_id: string | null; full_name: string; currency: string; insurance_paid_out: boolean };
  if (s.insurance_paid_out) { res.status(409).json({ error: 'Insurance has already been paid out' }); return; }

  const finalCurrency = (body.currency && body.currency.length >= 1 && body.currency.length <= 8 ? body.currency.toUpperCase() : s.currency);
  const heldTotal = await sumInsuranceHeld(id, finalCurrency);

  let payoutAmount: number;
  if (typeof body.amount === 'number') {
    if (body.amount < 0) { res.status(400).json({ error: 'amount must be non-negative' }); return; }
    payoutAmount = Math.round(body.amount * 100) / 100;
  } else {
    payoutAmount = heldTotal;
  }

  const paidOn = body.paidOn || new Date().toISOString().slice(0, 10);

  const { data: beforeIns } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();

  const { error } = await supabase.from('staff_members').update({
    insurance_paid_out: true,
    insurance_paid_out_at: paidOn,
    insurance_paid_out_amount: payoutAmount,
    insurance_paid_out_currency: finalCurrency,
    insurance_paid_out_notes: body.notes?.trim() || null,
  }).eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const { data: afterIns } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).single();
  await logAudit({ req, entityType: 'staff_member', entityId: id, action: 'update', before: beforeIns || undefined, after: afterIns || undefined, label: s.full_name, reason: 'Insurance paid out' });

  // Notify linked teacher (if any) that their insurance was paid out
  if (s.user_id) {
    await notify({
      schoolId,
      userId: s.user_id,
      type: 'salary_paid',
      title: 'Insurance paid out',
      message: `Your insurance of ${payoutAmount} ${finalCurrency} has been paid out on ${paidOn}.`,
      relatedId: id,
    });
  }

  res.json({ success: true });
}

export async function reverseStaffInsurancePayout(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id);
  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, insurance_paid_out')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }
  if (!(staff as { insurance_paid_out: boolean }).insurance_paid_out) {
    res.status(409).json({ error: 'Insurance has not been paid out' });
    return;
  }

  const { data: beforeRev } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();

  const { error } = await supabase.from('staff_members').update({
    insurance_paid_out: false,
    insurance_paid_out_at: null,
    insurance_paid_out_amount: null,
    insurance_paid_out_currency: null,
    insurance_paid_out_notes: null,
  }).eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const { data: afterRev } = await supabase.from('staff_members').select('*').eq('id', id).eq('school_id', schoolId).single();
  await logAudit({ req, entityType: 'staff_member', entityId: id, action: 'update', before: beforeRev || undefined, after: afterRev || undefined, label: (afterRev as { full_name?: string } | null)?.full_name, reason: 'Insurance payout reversed' });
  res.json({ success: true });
}

// ── Bulk next payment date (admin/accountant only) ────────────────────

export async function bulkSetNextPaymentDate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { nextPaymentDate, staffIds } = req.body as { nextPaymentDate?: string | null; staffIds?: string[] };

  // null/empty means "clear the date"
  const newDate: string | null = (nextPaymentDate === null || nextPaymentDate === undefined || (typeof nextPaymentDate === 'string' && nextPaymentDate.trim() === ''))
    ? null
    : nextPaymentDate;
  if (newDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    res.status(400).json({ error: 'nextPaymentDate must be YYYY-MM-DD or null' });
    return;
  }

  // Snapshot the affected staff rows before updating, so each per-staff audit
  // entry has accurate before/after values.
  let beforeQ = supabase
    .from('staff_members')
    .select('*')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .eq('is_active', true);
  if (Array.isArray(staffIds)) beforeQ = beforeQ.in('id', staffIds);
  const { data: beforeRows } = await beforeQ;
  const beforeById = new Map<string, Record<string, unknown>>();
  for (const r of (beforeRows || []) as Record<string, unknown>[]) beforeById.set(r.id as string, r);

  let q = supabase
    .from('staff_members')
    .update({ next_payment_date: newDate })
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .eq('is_active', true);

  if (Array.isArray(staffIds)) {
    if (staffIds.length === 0) { res.json({ updated: 0 }); return; }
    if (!staffIds.every(s => typeof s === 'string')) {
      res.status(400).json({ error: 'staffIds must be an array of strings' });
      return;
    }
    q = q.in('id', staffIds);
  }

  const { data, error } = await q.select('*');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  for (const row of (data || []) as Record<string, unknown>[]) {
    const id = row.id as string;
    const before = beforeById.get(id);
    await logAudit({ req, entityType: 'staff_member', entityId: id, action: 'update', before, after: row, label: row.full_name as string | undefined, reason: 'Bulk next-payment-date update' });
  }

  res.json({ updated: (data ?? []).length });
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
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
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

// ── Mass reminder (admin/accountant only) ──────────────────────────────

export async function notifyAllStaffDue(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { title, message, dueWithinDays } = req.body as { title?: string; message?: string; dueWithinDays?: number };
  const customTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
  const customMessage = typeof message === 'string' && message.trim() ? message.trim() : null;
  const filterDays = typeof dueWithinDays === 'number' && dueWithinDays >= 0 ? Math.floor(dueWithinDays) : null;

  const { data: staff, error } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, salary_amount, currency, next_payment_date, is_active, users!staff_members_user_id_fkey(is_active)')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .eq('is_active', true)
    .not('user_id', 'is', null);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const cutoffMs = filterDays !== null ? todayMs + filterDays * 86400000 : null;

  const payloads: { schoolId: string; userId: string; type: string; title: string; message: string; relatedId?: string }[] = [];
  for (const s of (staff ?? []) as RawStaffRow[]) {
    if (!s.user_id) continue;
    if (userIsActive(s.users) === false) continue;
    if (cutoffMs !== null) {
      if (!s.next_payment_date) continue;
      const dueMs = new Date(s.next_payment_date + 'T00:00:00Z').getTime();
      if (dueMs > cutoffMs) continue;
    }
    const dateText = s.next_payment_date ? ` on ${s.next_payment_date}` : ' soon';
    payloads.push({
      schoolId,
      userId: s.user_id,
      type: 'salary_due_soon',
      title: customTitle ?? 'Salary payment due',
      message: customMessage ?? `Your salary of ${s.salary_amount} ${s.currency} is due${dateText}. Please visit the accounting office.`,
      relatedId: s.id,
    });
  }

  if (payloads.length === 0) { res.json({ sent: 0 }); return; }

  await notifyMany(payloads);
  res.json({ sent: payloads.length });
}

// ── Per-staff salary export (PDF / XLSX) ───────────────────────────────

async function buildExportData(schoolId: string, staffId: string): Promise<StaffSalaryExportData | null> {
  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, user_id, full_name, position, salary_amount, currency, next_payment_date, is_active, insurance_percentage, insurance_paid_out, insurance_paid_out_at, insurance_paid_out_amount, insurance_paid_out_currency, insurance_paid_out_notes, users!staff_members_user_id_fkey(is_active)')
    .eq('id', staffId).eq('school_id', schoolId).is('voided_at', null).single();
  if (!staff) return null;

  const s = staff as RawStaffRow;
  const userActive = s.user_id ? (userIsActive(s.users) ?? false) : null;
  const effectiveActive = s.is_active && (userActive === null || userActive === true);
  const archiveReason = !s.is_active
    ? 'Deactivated by accounting'
    : (userActive === false ? 'Account deactivated' : null);

  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('amount, currency, paid_on, period_label, notes, insurance_amount, insurance_percentage')
    .eq('staff_id', staffId)
    .is('voided_at', null)
    .order('paid_on', { ascending: false });

  const { data: school } = await supabase
    .from('schools')
    .select('name, logo_url')
    .eq('id', schoolId).single();

  let insuranceHeld = 0;
  for (const p of (payments ?? []) as { currency: string; insurance_amount: number }[]) {
    if (p.currency === s.currency) insuranceHeld += Number(p.insurance_amount) || 0;
  }
  insuranceHeld = Math.round(insuranceHeld * 100) / 100;

  return {
    schoolName: (school as { name: string } | null)?.name ?? 'School',
    schoolLogoUrl: (school as { logo_url: string | null } | null)?.logo_url ?? null,
    fullName: s.full_name,
    position: s.position,
    salaryAmount: s.salary_amount,
    currency: s.currency,
    nextPaymentDate: s.next_payment_date,
    status: effectiveActive ? 'active' : 'archived',
    archiveReason,
    insurancePercentage: s.insurance_percentage,
    insuranceHeld,
    insurancePaidOut: s.insurance_paid_out,
    insurancePaidOutAt: s.insurance_paid_out_at,
    insurancePaidOutAmount: s.insurance_paid_out_amount,
    insurancePaidOutCurrency: s.insurance_paid_out_currency,
    insurancePaidOutNotes: s.insurance_paid_out_notes,
    payments: ((payments ?? []) as { amount: number; currency: string; paid_on: string; period_label: string | null; notes: string | null; insurance_amount: number; insurance_percentage: number | null }[])
      .map(p => ({
        amount: p.amount,
        currency: p.currency,
        paidOn: p.paid_on,
        periodLabel: p.period_label,
        notes: p.notes,
        insuranceAmount: Number(p.insurance_amount) || 0,
        insurancePercentage: p.insurance_percentage,
      })),
  };
}

export async function exportStaffSalaryPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const data = await buildExportData(schoolId, String(req.params.id));
  if (!data) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const safeName = data.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="salary-${safeName}.pdf"`);
  await streamStaffSalaryPdf(res, data);
}

export async function exportStaffSalaryXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const data = await buildExportData(schoolId, String(req.params.id));
  if (!data) { res.status(404).json({ error: 'Staff member not found' }); return; }

  const buf = buildStaffSalaryXlsx(data);
  const safeName = data.fullName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary-${safeName}.xlsx"`);
  res.send(buf);
}

// ── Teacher self-service: read-only "my salary" ────────────────────────

export async function getMyStaffInfo(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data: staff } = await supabase
    .from('staff_members')
    .select('id, full_name, position, salary_amount, currency, next_payment_date, is_active, insurance_percentage, insurance_paid_out, insurance_paid_out_at, insurance_paid_out_amount, insurance_paid_out_currency, insurance_paid_out_notes, created_at')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .eq('user_id', userId)
    .maybeSingle();

  if (!staff) { res.json({ staff: null, payments: [] }); return; }

  const staffRow = staff as { id: string; currency: string };
  const { data: payments } = await supabase
    .from('staff_salary_payments')
    .select('id, amount, currency, paid_on, period_label, notes, insurance_amount, insurance_percentage, created_at')
    .eq('staff_id', staffRow.id)
    .is('voided_at', null)
    .order('paid_on', { ascending: false });

  let insuranceHeld = 0;
  for (const p of (payments ?? []) as { currency: string; insurance_amount: number }[]) {
    if (p.currency === staffRow.currency) insuranceHeld += Number(p.insurance_amount) || 0;
  }
  insuranceHeld = Math.round(insuranceHeld * 100) / 100;

  const staffEnriched = { ...(toCC(staff) as Record<string, unknown>), insuranceHeldTotal: insuranceHeld };

  res.json({
    staff: staffEnriched,
    payments: toCC(payments ?? []),
  });
}
