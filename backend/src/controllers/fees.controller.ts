import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
// Accountant-role financial controller — elevated by design (period close,
// receipt issuance, cross-table aggregations). adminDb keeps service-role
// semantics; explicit `.eq('school_id', schoolId)` filters provide tenant
// scoping (Phase 0 elevated-path inventory).
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { streamPaymentReceipt, streamYearSummary } from '../utils/receipts';
import { streamArchivePaymentPdf, buildArchivePaymentXlsx, netPaid, type ArchivePaymentExportData, type ArchivePlanEntry } from '../utils/paymentArchiveExport';
import { logAudit } from '../utils/audit';
import { postTuitionBilling, postTuitionPayment, postRefund, reverseEntry, reinstateEntry } from '../utils/glPosting';
import { resolveDrawerAmount } from '../utils/fx';
import { resolveCurrentAcademicYear } from '../utils/studentEnrollments';
import { assertPeriodOpen } from '../utils/period';
import { allocateReceiptNumber } from '../utils/receiptNumber';
import { parseCursorParams, buildPageWith, keysetAfter } from '../utils/pagination';

// ── Types ──────────────────────────────────────────────────────────────

type ApplyTo = 'all' | 'classes' | 'manual';
type Status = 'paid_up' | 'current' | 'due_soon' | 'overdue';

interface SiblingDiscountTier { minSiblings: number; value: number }
interface SiblingDiscountConfig { enabled: boolean; type: 'percent' | 'fixed'; tiers: SiblingDiscountTier[] }
interface TuitionConfig { currency: string; siblingDiscount: SiblingDiscountConfig }

const DEFAULT_TUITION_CONFIG: TuitionConfig = {
  currency: 'USD',
  siblingDiscount: { enabled: false, type: 'percent', tiers: [] },
};

// ── Premium gate ────────────────────────────────────────────────────────

async function ensurePremium(schoolId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase.from('schools').select('features').eq('id', schoolId).single();
  if ((data?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    return { ok: false, status: 403, error: 'Tuition fees module is not enabled for this school.' };
  }
  return { ok: true };
}

async function getTuitionConfig(schoolId: string): Promise<TuitionConfig> {
  const { data } = await supabase.from('schools').select('tuition_config').eq('id', schoolId).single();
  const cfg = (data?.tuition_config as Partial<TuitionConfig> | null) ?? {};
  return {
    currency: cfg.currency ?? DEFAULT_TUITION_CONFIG.currency,
    siblingDiscount: cfg.siblingDiscount ?? DEFAULT_TUITION_CONFIG.siblingDiscount,
  };
}

// ── Status & sibling-discount math ──────────────────────────────────────

function computeStatus(
  installments: { sequence: number; amount: number; due_date: string }[],
  paid: number,
  dueTotal: number,
  todayISO: string,
): Status {
  if (paid >= dueTotal - 0.001) return 'paid_up';
  if (installments.length === 0) {
    // No installment schedule — treat as one big lump due immediately
    return paid > 0 ? 'current' : 'overdue';
  }
  let remaining = paid;
  const ordered = [...installments].sort((a, b) => a.sequence - b.sequence);
  for (const inst of ordered) {
    if (remaining >= inst.amount - 0.001) { remaining -= inst.amount; continue; }
    if (inst.due_date < todayISO) return 'overdue';
    const days = (new Date(inst.due_date + 'T00:00:00Z').getTime() - new Date(todayISO + 'T00:00:00Z').getTime()) / 86400000;
    if (days <= 7) return 'due_soon';
    return 'current';
  }
  return 'paid_up';
}

function computeSiblingDiscount(planTotal: number, siblings: number, cfg: SiblingDiscountConfig): number {
  if (!cfg.enabled || siblings < 2) return 0;
  const matching = cfg.tiers
    .filter(t => siblings >= t.minSiblings)
    .sort((a, b) => b.minSiblings - a.minSiblings);
  if (matching.length === 0) return 0;
  const tier = matching[0];
  return cfg.type === 'percent'
    ? Math.round((planTotal * tier.value) / 100 * 100) / 100
    : tier.value;
}

// Scale each installment proportionally so they sum to the actual due amount
// after adjustment + sibling discount. Pushes any rounding diff to the last
// installment so the total matches exactly.
function scaleInstallments<T extends { sequence: number; amount: number }>(
  installments: T[],
  totalDue: number,
): (T & { effectiveAmount: number })[] {
  if (installments.length === 0) return [];
  const baseSum = installments.reduce((s, i) => s + Number(i.amount), 0);
  const sorted = [...installments].sort((a, b) => a.sequence - b.sequence);
  const scale = baseSum > 0 ? totalDue / baseSum : 1;
  const scaled = sorted.map(i => ({
    ...i,
    effectiveAmount: Math.round(Number(i.amount) * scale * 100) / 100,
  }));
  const sumScaled = scaled.reduce((s, x) => s + x.effectiveAmount, 0);
  const drift = Math.round((totalDue - sumScaled) * 100) / 100;
  if (Math.abs(drift) >= 0.01 && scaled.length > 0) {
    const last = scaled[scaled.length - 1];
    last.effectiveAmount = Math.round((last.effectiveAmount + drift) * 100) / 100;
  }
  return scaled;
}

// Build a (parentId+academicYear)→count map for sibling-discount math.
function buildSiblingCounts(rows: { student_id: string; parentId: string | null; academicYear: string | null }[]): Map<string, number> {
  const buckets = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const key = `${r.parentId}::${r.academicYear ?? ''}`;
    const set = buckets.get(key) ?? new Set();
    set.add(r.student_id);
    buckets.set(key, set);
  }
  const out = new Map<string, number>();
  for (const [k, v] of buckets) out.set(k, v.size);
  return out;
}

// ── Plans ───────────────────────────────────────────────────────────────

export async function listPlans(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data: plans, error } = await supabase
    .from('fee_plans')
    .select('id, name, total_amount, currency, applies_to, academic_year, is_active, kind, late_fee_enabled, late_fee_type, late_fee_amount, late_fee_grace_days, created_at')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const planIds = (plans ?? []).map(p => p.id);
  const [{ data: insts }, { data: classes }] = await Promise.all([
    planIds.length ? supabase.from('fee_installments').select('fee_plan_id, id, sequence, amount, due_date').in('fee_plan_id', planIds).order('sequence') : Promise.resolve({ data: [] as any[] }),
    planIds.length ? supabase.from('fee_plan_classes').select('fee_plan_id, class_id').in('fee_plan_id', planIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const installmentsByPlan = new Map<string, any[]>();
  for (const i of insts ?? []) {
    const arr = installmentsByPlan.get((i as any).fee_plan_id) ?? [];
    arr.push({ id: (i as any).id, sequence: (i as any).sequence, amount: Number((i as any).amount), dueDate: (i as any).due_date });
    installmentsByPlan.set((i as any).fee_plan_id, arr);
  }
  const classesByPlan = new Map<string, string[]>();
  for (const c of classes ?? []) {
    const arr = classesByPlan.get((c as any).fee_plan_id) ?? [];
    arr.push((c as any).class_id);
    classesByPlan.set((c as any).fee_plan_id, arr);
  }

  res.json((plans ?? []).map(p => ({
    id: p.id,
    name: p.name,
    totalAmount: Number(p.total_amount),
    currency: p.currency,
    appliesTo: p.applies_to,
    academicYear: p.academic_year,
    isActive: p.is_active,
    kind: (p as any).kind ?? 'tuition',
    lateFeeEnabled: (p as any).late_fee_enabled ?? false,
    lateFeeType: (p as any).late_fee_type ?? null,
    lateFeeAmount: Number((p as any).late_fee_amount ?? 0),
    lateFeeGraceDays: Number((p as any).late_fee_grace_days ?? 0),
    createdAt: p.created_at,
    installments: installmentsByPlan.get(p.id) ?? [],
    classIds: classesByPlan.get(p.id) ?? [],
  })));
}

type FeePlanKind = 'tuition' | 'transport' | 'lunch' | 'uniform' | 'exam' | 'registration' | 'other';
const FEE_PLAN_KINDS: FeePlanKind[] = ['tuition', 'transport', 'lunch', 'uniform', 'exam', 'registration', 'other'];

interface PlanWriteBody {
  name: string;
  totalAmount: number;
  currency?: string;
  appliesTo: ApplyTo;
  classIds?: string[];
  academicYear?: string;
  installments: { sequence: number; amount: number; dueDate: string }[];
  isActive?: boolean;
  kind?: FeePlanKind;
  lateFeeEnabled?: boolean;
  lateFeeType?: 'fixed' | 'percent' | null;
  lateFeeAmount?: number;
  lateFeeGraceDays?: number;
}

function validatePlanBody(body: any): string | null {
  if (!body?.name || typeof body.name !== 'string') return 'name is required';
  if (typeof body.totalAmount !== 'number' || body.totalAmount < 0) return 'totalAmount must be a non-negative number';
  if (!['all', 'classes', 'manual'].includes(body.appliesTo)) return 'appliesTo must be all|classes|manual';
  // Installments are optional for one-off fees (exam, uniform, registration);
  // if omitted, the plan is treated as a single lump-sum due immediately.
  if (body.installments !== undefined) {
    if (!Array.isArray(body.installments)) return 'installments must be an array';
    if (body.installments.length > 0) {
      const sumI = body.installments.reduce((s: number, i: any) => s + Number(i.amount), 0);
      if (Math.abs(sumI - body.totalAmount) > 0.01) return 'installments must sum to totalAmount';
    }
  }
  if (body.appliesTo === 'classes' && (!Array.isArray(body.classIds) || body.classIds.length === 0)) {
    return 'classIds must be a non-empty array when appliesTo=classes';
  }
  if (body.kind !== undefined && !FEE_PLAN_KINDS.includes(body.kind)) {
    return `kind must be one of ${FEE_PLAN_KINDS.join(', ')}`;
  }
  if (body.lateFeeEnabled) {
    if (body.lateFeeType !== 'fixed' && body.lateFeeType !== 'percent') return 'lateFeeType must be fixed|percent when late fees are enabled';
    if (typeof body.lateFeeAmount !== 'number' || body.lateFeeAmount < 0) return 'lateFeeAmount must be a non-negative number';
    if (body.lateFeeGraceDays !== undefined && (typeof body.lateFeeGraceDays !== 'number' || body.lateFeeGraceDays < 0)) return 'lateFeeGraceDays must be a non-negative number';
  }
  return null;
}

export async function createPlan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const body = req.body as PlanWriteBody;
  const err = validatePlanBody(body);
  if (err) { res.status(400).json({ error: err }); return; }

  const cfg = await getTuitionConfig(schoolId);
  const currency = body.currency || cfg.currency || 'USD';

  const { data: plan, error: pErr } = await supabase.from('fee_plans').insert({
    school_id: schoolId,
    name: body.name,
    total_amount: body.totalAmount,
    currency,
    applies_to: body.appliesTo,
    academic_year: body.academicYear ?? null,
    is_active: body.isActive ?? true,
    kind: body.kind ?? 'tuition',
    late_fee_enabled: body.lateFeeEnabled ?? false,
    late_fee_type: body.lateFeeEnabled ? body.lateFeeType ?? null : null,
    late_fee_amount: body.lateFeeEnabled ? body.lateFeeAmount ?? 0 : 0,
    late_fee_grace_days: body.lateFeeEnabled ? body.lateFeeGraceDays ?? 0 : 0,
  }).select().single();
  if (pErr || !plan) { res.status(500).json({ error: pErr?.message ?? 'Failed to create plan' }); return; }

  if ((body.installments ?? []).length) {
    const rows = (body.installments ?? []).map(i => ({
      school_id: schoolId,
      fee_plan_id: plan.id,
      sequence: i.sequence,
      amount: i.amount,
      due_date: i.dueDate,
    }));
    const { error: iErr } = await supabase.from('fee_installments').insert(rows);
    if (iErr) { await supabase.from('fee_plans').delete().eq('id', plan.id); res.status(safeDbErrorStatus(iErr)).json({ error: safeDbErrorMessage(iErr) }); return; }
  }
  if (body.appliesTo === 'classes' && body.classIds?.length) {
    const cRows = body.classIds.map(id => ({ fee_plan_id: plan.id, class_id: id }));
    const { error: cErr } = await supabase.from('fee_plan_classes').insert(cRows);
    if (cErr) { await supabase.from('fee_plans').delete().eq('id', plan.id); res.status(safeDbErrorStatus(cErr)).json({ error: safeDbErrorMessage(cErr) }); return; }
  }

  await logAudit({ req, entityType: 'fee_plan', entityId: plan.id, action: 'create', after: plan, label: plan.name });
  res.status(201).json(toCC(plan));
}

export async function updatePlan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const body = req.body as PlanWriteBody;
  const err = validatePlanBody(body);
  if (err) { res.status(400).json({ error: err }); return; }

  const { data: before } = await supabase.from('fee_plans').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Plan not found' }); return; }

  const { error: pErr } = await supabase.from('fee_plans').update({
    name: body.name,
    total_amount: body.totalAmount,
    currency: body.currency,
    applies_to: body.appliesTo,
    academic_year: body.academicYear ?? null,
    is_active: body.isActive ?? true,
    kind: body.kind ?? 'tuition',
    late_fee_enabled: body.lateFeeEnabled ?? false,
    late_fee_type: body.lateFeeEnabled ? body.lateFeeType ?? null : null,
    late_fee_amount: body.lateFeeEnabled ? body.lateFeeAmount ?? 0 : 0,
    late_fee_grace_days: body.lateFeeEnabled ? body.lateFeeGraceDays ?? 0 : 0,
  }).eq('id', id).eq('school_id', schoolId);
  if (pErr) { res.status(safeDbErrorStatus(pErr)).json({ error: safeDbErrorMessage(pErr) }); return; }

  const { data: after } = await supabase.from('fee_plans').select('*').eq('id', id).eq('school_id', schoolId).single();
  await logAudit({ req, entityType: 'fee_plan', entityId: String(id), action: 'update', before: before || undefined, after: after || undefined, label: (after as { name?: string } | null)?.name ?? body.name });

  // Replace installments + class targets atomically (best effort — no transaction support via PostgREST)
  await supabase.from('fee_installments').delete().eq('fee_plan_id', id).eq('school_id', schoolId);
  if ((body.installments ?? []).length) {
    await supabase.from('fee_installments').insert((body.installments ?? []).map(i => ({
      school_id: schoolId, fee_plan_id: id, sequence: i.sequence, amount: i.amount, due_date: i.dueDate,
    })));
  }
  await supabase.from('fee_plan_classes').delete().eq('fee_plan_id', id);
  if (body.appliesTo === 'classes' && body.classIds?.length) {
    await supabase.from('fee_plan_classes').insert(body.classIds.map(c => ({ fee_plan_id: id, class_id: c })));
  }

  res.json({ success: true });
}

export async function deletePlan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  const { data: before } = await supabase.from('fee_plans').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Plan not found' }); return; }
  // Block void if any non-voided payment has been recorded against any student_fee under this plan.
  const { data: sfs } = await supabase.from('student_fees').select('id').eq('school_id', schoolId).eq('fee_plan_id', id);
  if (sfs && sfs.length) {
    const sfIds = sfs.map(s => (s as any).id);
    const { count } = await supabase.from('fee_payments').select('id', { count: 'exact', head: true }).in('student_fee_id', sfIds).is('voided_at', null);
    if ((count ?? 0) > 0) {
      res.status(409).json({ error: 'Cannot void a plan with recorded payments. Void those payments first, or mark the plan inactive instead.' });
      return;
    }
  }
  const { data: after, error } = await supabase
    .from('fee_plans')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'fee_plan', entityId: String(id), action: 'update', before, after, label: (before as { name?: string }).name, reason: reason ?? undefined });
  res.json({ success: true });
}

export async function unvoidPlan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase.from('fee_plans').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!before || !(before as any).voided_at) { res.status(404).json({ error: 'Voided plan not found' }); return; }
  const { data: after, error } = await supabase
    .from('fee_plans')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'fee_plan', entityId: String(id), action: 'update', before, after, label: (before as { name?: string }).name });
  res.json({ success: true });
}

export async function listVoidedPlans(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  let q = supabase
    .from('fee_plans')
    .select('id, name, total_amount, currency, applies_to, academic_year, is_active, created_at, voided_at, voided_by, void_reason')
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

// Assign a plan to students (all / by class / explicit). Creates student_fees rows
// for any student that doesn't already have one for this plan; existing rows are left alone.
export async function assignPlan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { studentIds: bodyStudentIds } = req.body as { studentIds?: string[] };

  const { data: plan } = await supabase
    .from('fee_plans').select('id, total_amount, applies_to, currency, kind').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

  let studentIds: string[] = [];
  if (plan.applies_to === 'manual' && bodyStudentIds?.length) {
    studentIds = bodyStudentIds;
  } else if (plan.applies_to === 'all') {
    const { data } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('is_graduated', false);
    studentIds = (data ?? []).map(s => (s as any).id);
  } else if (plan.applies_to === 'classes') {
    const { data: targets } = await supabase.from('fee_plan_classes').select('class_id').eq('fee_plan_id', id);
    const classIds = (targets ?? []).map(t => (t as any).class_id);
    if (classIds.length) {
      const { data } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('is_graduated', false).in('class_id', classIds);
      studentIds = (data ?? []).map(s => (s as any).id);
    }
  }

  if (studentIds.length === 0) { res.json({ assigned: 0 }); return; }

  // Find which students already have a row for this plan
  const { data: existing } = await supabase
    .from('student_fees').select('student_id').eq('school_id', schoolId).eq('fee_plan_id', id).in('student_id', studentIds);
  const existingSet = new Set((existing ?? []).map(e => (e as any).student_id));
  const toInsert = studentIds.filter(sid => !existingSet.has(sid));

  if (toInsert.length === 0) { res.json({ assigned: 0, skipped: studentIds.length }); return; }

  const rows = toInsert.map(sid => ({
    school_id: schoolId,
    student_id: sid,
    fee_plan_id: id,
    total_amount: plan.total_amount,
  }));
  const { data: inserted, error } = await supabase.from('student_fees').insert(rows).select();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const billingDate = new Date().toISOString().split('T')[0];
  for (const row of (inserted || [])) {
    const r = row as { id: string; student_id: string; total_amount: number };
    await logAudit({ req, entityType: 'student_fee', entityId: r.id, action: 'create', after: row as Record<string, unknown>, reason: 'Plan assigned' });
    // GL: recognise the receivable when the fee is billed (accrual).
    await postTuitionBilling({
      schoolId, studentFeeId: r.id, studentId: r.student_id,
      amount: Number(r.total_amount) || 0,
      currency: (plan as { currency?: string }).currency || 'USD',
      feeKind: (plan as { kind?: string }).kind ?? 'tuition',
      entryDate: billingDate, postedBy: req.user!.userId,
    });
  }
  res.json({ assigned: toInsert.length, skipped: studentIds.length - toInsert.length });
}

// ── Students/families list (admin/accountant + reception read; admin/accountant write) ──

interface StudentFeeRow {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  className: string | null;
  parentId: string | null;
  parentName: string | null;
  parentUserId: string | null;
  planId: string;
  planName: string;
  academicYear: string | null;
  currency: string;
  totalAmount: number;
  adjustment: number;
  siblingDiscount: number;
  lateFees: number;
  paid: number;
  balance: number;
  status: Status;
  installments: { id: string; sequence: number; amount: number; effectiveAmount: number; dueDate: string }[];
  lockedFeatures: string[];
  kind?: string;
}

export async function buildStudentFeeRows(schoolId: string): Promise<StudentFeeRow[]> {
  const cfg = await getTuitionConfig(schoolId);
  const today = new Date().toISOString().split('T')[0];

  const { data: sfs, error } = await supabase
    .from('student_fees')
    .select(`
      id, student_id, total_amount, adjustment, fee_plan_id,
      students!inner(id, full_name, parent_id, classes(name), parents(id, full_name, user_id)),
      fee_plans!inner(id, name, currency, academic_year, kind)
    `)
    .eq('school_id', schoolId);
  if (error || !sfs) return [];

  const planIds = Array.from(new Set(sfs.map(s => (s as any).fee_plan_id)));
  const studentIds = Array.from(new Set(sfs.map(s => (s as any).student_id)));
  const sfIds = sfs.map(s => (s as any).id);

  const [{ data: insts }, { data: pays }, { data: locks }, { data: lateFees }] = await Promise.all([
    supabase.from('fee_installments').select('fee_plan_id, id, sequence, amount, due_date').in('fee_plan_id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('fee_payments').select('student_fee_id, amount, is_refund').in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000']).is('voided_at', null),
    supabase.from('student_access_locks').select('student_id, feature').in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('student_fee_late_fees').select('student_fee_id, amount').in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000']).is('voided_at', null),
  ]);

  const instByPlan = new Map<string, { id: string; sequence: number; amount: number; dueDate: string; due_date: string }[]>();
  for (const i of insts ?? []) {
    const arr = instByPlan.get((i as any).fee_plan_id) ?? [];
    arr.push({ id: (i as any).id, sequence: (i as any).sequence, amount: Number((i as any).amount), dueDate: (i as any).due_date, due_date: (i as any).due_date });
    instByPlan.set((i as any).fee_plan_id, arr);
  }
  // "Paid" = positive payments minus refunds (both stored as positive amounts on fee_payments).
  const paidBySf = new Map<string, number>();
  for (const p of pays ?? []) {
    const sign = (p as any).is_refund ? -1 : 1;
    paidBySf.set((p as any).student_fee_id, (paidBySf.get((p as any).student_fee_id) ?? 0) + sign * Number((p as any).amount));
  }
  const lateFeesBySf = new Map<string, number>();
  for (const lf of lateFees ?? []) {
    lateFeesBySf.set((lf as any).student_fee_id, (lateFeesBySf.get((lf as any).student_fee_id) ?? 0) + Number((lf as any).amount));
  }
  const locksByStudent = new Map<string, Set<string>>();
  for (const l of locks ?? []) {
    const set = locksByStudent.get((l as any).student_id) ?? new Set<string>();
    set.add((l as any).feature);
    locksByStudent.set((l as any).student_id, set);
  }

  // Sibling counts: bucket by (parent_id + plan.academic_year), counting distinct students
  const siblingInput = sfs.map((s: any) => ({
    student_id: s.student_id,
    parentId: s.students?.parent_id ?? null,
    academicYear: s.fee_plans?.academic_year ?? null,
  }));
  const siblingCounts = buildSiblingCounts(siblingInput);

  return sfs.map((s: any) => {
    const installments = instByPlan.get(s.fee_plan_id) ?? [];
    const paid = paidBySf.get(s.id) ?? 0;
    const totalAmount = Number(s.total_amount);
    const adjustment = Number(s.adjustment);
    const academicYear = s.fee_plans?.academic_year ?? null;
    const parentId = s.students?.parent_id ?? null;
    const siblings = parentId ? siblingCounts.get(`${parentId}::${academicYear ?? ''}`) ?? 1 : 1;
    const siblingDiscount = computeSiblingDiscount(totalAmount, siblings, cfg.siblingDiscount);
    const lateFees = Math.round((lateFeesBySf.get(s.id) ?? 0) * 100) / 100;
    const dueTotal = totalAmount + adjustment - siblingDiscount + lateFees;
    const status = computeStatus(installments, paid, dueTotal, today);

    return {
      id: s.id,
      schoolId,
      studentId: s.student_id,
      studentName: s.students?.full_name ?? '',
      className: s.students?.classes?.name ?? null,
      parentId,
      parentName: s.students?.parents?.full_name ?? null,
      parentUserId: s.students?.parents?.user_id ?? null,
      planId: s.fee_plan_id,
      planName: s.fee_plans?.name ?? '',
      academicYear,
      currency: s.fee_plans?.currency ?? cfg.currency,
      kind: s.fee_plans?.kind ?? 'tuition',
      totalAmount,
      adjustment,
      siblingDiscount,
      lateFees,
      paid,
      balance: Math.max(0, dueTotal - paid),
      status,
      installments: scaleInstallments(
        installments.map(i => ({ id: i.id, sequence: i.sequence, amount: i.amount, dueDate: i.dueDate })),
        dueTotal,
      ),
      lockedFeatures: Array.from(locksByStudent.get(s.student_id) ?? []),
    };
  });
}

export async function listStudentFees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const rows = await buildStudentFeeRows(schoolId);
  res.json(rows);
}

export async function listFamilies(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const rows = await buildStudentFeeRows(schoolId);

  const groups = new Map<string, { parentId: string; parentName: string; parentUserId: string | null; students: StudentFeeRow[] }>();
  for (const r of rows) {
    const key = r.parentId ?? `unparented::${r.studentId}`;
    const g = groups.get(key) ?? {
      parentId: r.parentId ?? '',
      parentName: r.parentName ?? r.studentName,
      parentUserId: r.parentUserId,
      students: [],
    };
    g.students.push(r);
    groups.set(key, g);
  }

  const out = Array.from(groups.values()).map(g => ({
    parentId: g.parentId,
    parentName: g.parentName,
    parentUserId: g.parentUserId,
    students: g.students,
    totalDue: g.students.reduce((s, r) => s + (r.totalAmount + r.adjustment - r.siblingDiscount + r.lateFees), 0),
    totalPaid: g.students.reduce((s, r) => s + r.paid, 0),
    totalBalance: g.students.reduce((s, r) => s + r.balance, 0),
    currency: g.students[0]?.currency ?? 'USD',
  }));
  out.sort((a, b) => a.parentName.localeCompare(b.parentName));
  res.json(out);
}

export async function getStudentFee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const rows = await buildStudentFeeRows(schoolId);
  const row = rows.find(r => r.id === id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const { data: payments } = await supabase
    .from('fee_payments')
    .select('id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at, currency, tax_amount, tax_label, payment_account_id, receipt_year, receipt_number, is_refund, refund_of_payment_id')
    .eq('student_fee_id', id)
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .order('paid_on', { ascending: false });

  const paymentIds = (payments ?? []).map(p => (p as any).id);
  const recorderIds = Array.from(new Set((payments ?? []).map(p => (p as any).recorded_by).filter(Boolean)));
  const [{ data: allocs }, { data: users }] = await Promise.all([
    paymentIds.length
      ? supabase
          .from('fee_payment_allocations')
          .select('fee_payment_id, fee_installment_id, amount, fee_installments(sequence, due_date)')
          .in('fee_payment_id', paymentIds)
      : Promise.resolve({ data: [] as any[] }),
    recorderIds.length
      ? supabase.from('users').select('id, first_name, last_name').in('id', recorderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const allocsByPayment = new Map<string, any[]>();
  for (const a of (allocs ?? []) as any[]) {
    const arr = allocsByPayment.get(a.fee_payment_id) ?? [];
    arr.push({
      installmentId: a.fee_installment_id,
      amount: Number(a.amount),
      sequence: a.fee_installments?.sequence ?? null,
      dueDate: a.fee_installments?.due_date ?? null,
    });
    allocsByPayment.set(a.fee_payment_id, arr);
  }
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }

  res.json({
    ...row,
    payments: (payments ?? []).map(p => {
      const allocs = (allocsByPayment.get((p as any).id) ?? []).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      const allocSum = allocs.reduce((s, a) => s + a.amount, 0);
      const unallocatedAmount = Math.round((Number((p as any).amount) - allocSum) * 100) / 100;
      return {
        id: (p as any).id,
        amount: Number((p as any).amount),
        paidOn: (p as any).paid_on,
        method: (p as any).method,
        reference: (p as any).reference,
        notes: (p as any).notes,
        unallocatedNote: (p as any).unallocated_note ?? null,
        unallocatedAmount: allocs.length > 0 && unallocatedAmount > 0 ? unallocatedAmount : 0,
        recordedBy: (p as any).recorded_by,
        recorderName: (p as any).recorded_by ? nameByUser.get((p as any).recorded_by) ?? null : null,
        allocations: allocs,
        createdAt: (p as any).created_at,
        currency: (p as any).currency ?? null,
        taxAmount: Number((p as any).tax_amount ?? 0),
        taxLabel: (p as any).tax_label ?? null,
        paymentAccountId: (p as any).payment_account_id ?? null,
        receiptYear: (p as any).receipt_year ?? null,
        receiptNumber: (p as any).receipt_number ?? null,
        isRefund: !!(p as any).is_refund,
        refundOfPaymentId: (p as any).refund_of_payment_id ?? null,
      };
    }),
  });
}

// ── Per-student rollups (used by the new tabbed student detail page) ────
// listStudentRollup: one row per student, summarizing all their fee plans
//   into kind badges + per-currency balance totals + worst-of statuses.
// getStudentDetail: every plan for one student, each with its installments
//   + payment history attached. Drives the tabbed UI.

// Status precedence — used to roll multiple plans' statuses into one badge
// on the deduplicated list row (overdue beats due_soon beats current beats paid_up).
const STATUS_RANK: Record<Status, number> = { overdue: 3, due_soon: 2, current: 1, paid_up: 0 };

export async function listStudentRollup(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const rows = await buildStudentFeeRows(schoolId);

  interface Plan {
    studentFeeId: string;
    planId: string;
    planName: string;
    kind: string;
    academicYear: string | null;
    currency: string;
    totalAmount: number;
    adjustment: number;
    siblingDiscount: number;
    lateFees: number;
    paid: number;
    balance: number;
    status: Status;
  }
  interface Rollup {
    studentId: string;
    studentName: string;
    className: string | null;
    parentId: string | null;
    parentName: string | null;
    parentUserId: string | null;
    plans: Plan[];
    totalsByCurrency: { currency: string; due: number; paid: number; balance: number }[];
    worstStatus: Status;
    kinds: string[];
    lockedFeatures: string[];
  }

  const byStudent = new Map<string, Rollup>();
  for (const r of rows) {
    let g = byStudent.get(r.studentId);
    if (!g) {
      g = {
        studentId: r.studentId,
        studentName: r.studentName,
        className: r.className,
        parentId: r.parentId,
        parentName: r.parentName,
        parentUserId: r.parentUserId,
        plans: [],
        totalsByCurrency: [],
        worstStatus: 'paid_up',
        kinds: [],
        lockedFeatures: r.lockedFeatures,
      };
      byStudent.set(r.studentId, g);
    }
    g.plans.push({
      studentFeeId: r.id,
      planId: r.planId,
      planName: r.planName,
      kind: r.kind ?? 'tuition',
      academicYear: r.academicYear,
      currency: r.currency,
      totalAmount: r.totalAmount,
      adjustment: r.adjustment,
      siblingDiscount: r.siblingDiscount,
      lateFees: r.lateFees,
      paid: r.paid,
      balance: r.balance,
      status: r.status,
    });
    if (STATUS_RANK[r.status] > STATUS_RANK[g.worstStatus]) g.worstStatus = r.status;
  }

  // Finalize each group: per-currency totals + deduped kinds (preserving order)
  for (const g of byStudent.values()) {
    const totals = new Map<string, { due: number; paid: number; balance: number }>();
    const seenKinds = new Set<string>();
    g.kinds = [];
    for (const p of g.plans) {
      const due = p.totalAmount + p.adjustment - p.siblingDiscount + p.lateFees;
      const slot = totals.get(p.currency) ?? { due: 0, paid: 0, balance: 0 };
      slot.due += due;
      slot.paid += p.paid;
      slot.balance += p.balance;
      totals.set(p.currency, slot);
      if (!seenKinds.has(p.kind)) {
        seenKinds.add(p.kind);
        g.kinds.push(p.kind);
      }
    }
    g.totalsByCurrency = Array.from(totals.entries()).map(([currency, t]) => ({
      currency,
      due: Math.round(t.due * 100) / 100,
      paid: Math.round(t.paid * 100) / 100,
      balance: Math.round(t.balance * 100) / 100,
    }));
  }

  const out = Array.from(byStudent.values()).sort((a, b) => a.studentName.localeCompare(b.studentName));
  res.json(out);
}

export async function getStudentDetail(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { studentId } = req.params;
  const allRows = await buildStudentFeeRows(schoolId);
  const studentRows = allRows.filter(r => r.studentId === studentId);
  if (studentRows.length === 0) { res.status(404).json({ error: 'Student has no fees' }); return; }

  const head = studentRows[0]; // shared identity fields are the same on every row

  const sfIds = studentRows.map(r => r.id);
  const { data: payments } = await supabase
    .from('fee_payments')
    .select('id, student_fee_id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at, currency, tax_amount, tax_label, payment_account_id, receipt_year, receipt_number, is_refund, refund_of_payment_id')
    .eq('school_id', schoolId)
    .in('student_fee_id', sfIds)
    .is('voided_at', null)
    .order('paid_on', { ascending: false });

  const paymentIds = (payments ?? []).map(p => (p as any).id);
  const recorderIds = Array.from(new Set((payments ?? []).map(p => (p as any).recorded_by).filter(Boolean)));
  const [{ data: allocs }, { data: users }] = await Promise.all([
    paymentIds.length
      ? supabase
          .from('fee_payment_allocations')
          .select('fee_payment_id, fee_installment_id, amount, fee_installments(sequence, due_date)')
          .in('fee_payment_id', paymentIds)
      : Promise.resolve({ data: [] as any[] }),
    recorderIds.length
      ? supabase.from('users').select('id, first_name, last_name').in('id', recorderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const allocsByPayment = new Map<string, any[]>();
  for (const a of (allocs ?? []) as any[]) {
    const arr = allocsByPayment.get(a.fee_payment_id) ?? [];
    arr.push({
      installmentId: a.fee_installment_id,
      amount: Number(a.amount),
      sequence: a.fee_installments?.sequence ?? null,
      dueDate: a.fee_installments?.due_date ?? null,
    });
    allocsByPayment.set(a.fee_payment_id, arr);
  }
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }

  // Group payments by student_fee_id
  const paymentsBySf = new Map<string, any[]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsBySf.get(p.student_fee_id) ?? [];
    const allocList = (allocsByPayment.get(p.id) ?? []).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const allocSum = allocList.reduce((s, a) => s + a.amount, 0);
    const unallocatedAmount = Math.round((Number(p.amount) - allocSum) * 100) / 100;
    arr.push({
      id: p.id,
      amount: Number(p.amount),
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      unallocatedNote: p.unallocated_note ?? null,
      unallocatedAmount: allocList.length > 0 && unallocatedAmount > 0 ? unallocatedAmount : 0,
      recordedBy: p.recorded_by,
      recorderName: p.recorded_by ? nameByUser.get(p.recorded_by) ?? null : null,
      allocations: allocList,
      createdAt: p.created_at,
      currency: p.currency ?? null,
      taxAmount: Number(p.tax_amount ?? 0),
      taxLabel: p.tax_label ?? null,
      paymentAccountId: p.payment_account_id ?? null,
      receiptYear: p.receipt_year ?? null,
      receiptNumber: p.receipt_number ?? null,
      isRefund: !!p.is_refund,
      refundOfPaymentId: p.refund_of_payment_id ?? null,
    });
    paymentsBySf.set(p.student_fee_id, arr);
  }

  res.json({
    studentId: head.studentId,
    studentName: head.studentName,
    className: head.className,
    parentId: head.parentId,
    parentName: head.parentName,
    parentUserId: head.parentUserId,
    lockedFeatures: head.lockedFeatures,
    plans: studentRows.map(r => ({
      studentFeeId: r.id,
      planId: r.planId,
      planName: r.planName,
      kind: r.kind ?? 'tuition',
      academicYear: r.academicYear,
      currency: r.currency,
      totalAmount: r.totalAmount,
      adjustment: r.adjustment,
      siblingDiscount: r.siblingDiscount,
      lateFees: r.lateFees,
      paid: r.paid,
      balance: r.balance,
      status: r.status,
      installments: r.installments,
      payments: paymentsBySf.get(r.id) ?? [],
    })),
  });
}

// ── Payments (admin only) ───────────────────────────────────────────────

export async function recordPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // student_fee_id
  const { amount, paidOn, method, reference, notes, unallocatedNote, currency, taxAmount, taxLabel, paymentAccountId } = req.body;
  const rawAllocations = req.body.allocations;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!paidOn) { res.status(400).json({ error: 'paidOn is required' }); return; }
  if (taxAmount !== undefined && (typeof taxAmount !== 'number' || taxAmount < 0)) { res.status(400).json({ error: 'taxAmount must be a non-negative number' }); return; }

  // Period close guard — block writes into a closed accounting period
  const periodGuard = await assertPeriodOpen(schoolId, [paidOn]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  // Validate allocations if provided. Each entry { installmentId, amount }.
  // Allocations may sum to less than the payment total — the difference is the
  // "unallocated / advance" portion, which requires an explanatory note.
  let allocations: { installmentId: string; amount: number }[] | null = null;
  let storedUnallocatedNote: string | null = null;
  if (rawAllocations !== undefined && rawAllocations !== null) {
    if (!Array.isArray(rawAllocations)) { res.status(400).json({ error: 'allocations must be an array' }); return; }
    const cleaned: { installmentId: string; amount: number }[] = [];
    for (const a of rawAllocations) {
      if (!a || typeof a.installmentId !== 'string' || typeof a.amount !== 'number' || a.amount <= 0) {
        res.status(400).json({ error: 'Each allocation needs installmentId and a positive amount' }); return;
      }
      cleaned.push({ installmentId: a.installmentId, amount: a.amount });
    }
    if (cleaned.length > 0) {
      const sum = cleaned.reduce((s, a) => s + a.amount, 0);
      if (sum > amount + 0.01) { res.status(400).json({ error: 'Allocation amounts exceed the payment total' }); return; }
      const unallocated = Math.round((amount - sum) * 100) / 100;
      if (unallocated > 0.01) {
        const trimmed = typeof unallocatedNote === 'string' ? unallocatedNote.trim() : '';
        if (!trimmed) { res.status(400).json({ error: 'A note is required when an unallocated amount is recorded' }); return; }
        storedUnallocatedNote = trimmed;
      }
      allocations = cleaned;
    }
  }

  // Verify student_fee exists in this school + grab plan currency
  const { data: sf } = await supabase
    .from('student_fees')
    .select('id, fee_plan_id, student_id, students(full_name, parents(user_id)), fee_plans(currency)')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!sf) { res.status(404).json({ error: 'Student fee not found' }); return; }

  // If allocations were provided, verify every installment belongs to this fee's plan & school
  if (allocations && allocations.length > 0) {
    const { data: insts } = await supabase
      .from('fee_installments')
      .select('id, fee_plan_id')
      .in('id', allocations.map(a => a.installmentId))
      .eq('school_id', schoolId);
    const validIds = new Set((insts ?? []).filter((i: any) => i.fee_plan_id === (sf as any).fee_plan_id).map((i: any) => i.id));
    for (const a of allocations) {
      if (!validIds.has(a.installmentId)) { res.status(400).json({ error: 'Allocation references an installment from a different plan' }); return; }
    }
  }

  // The fee's denomination is authoritative: plan currency, else school
  // default. A client-supplied currency may only CONFIRM it — the balance
  // math sums raw payment amounts against the plan total, so accepting a
  // different currency here would count 1,000 IQD as 1,000 USD paid.
  // (Cross-currency cash is handled below via the drawer conversion.)
  const cfgForCurrency = await getTuitionConfig(schoolId);
  const resolvedCurrency = ((sf as any).fee_plans?.currency
    || cfgForCurrency.currency
    || 'USD').toUpperCase();
  if (typeof currency === 'string' && currency.trim()
      && currency.trim().toUpperCase() !== resolvedCurrency) {
    res.status(400).json({ error: `Payments on this fee must be recorded in ${resolvedCurrency}. To pay from a drawer in another currency, pick that drawer — the conversion is automatic.` });
    return;
  }

  // Cross-currency: the fee is denominated in resolvedCurrency; if the chosen
  // drawer is in another currency, convert so the cash entering the drawer is
  // in the drawer's currency. amount/currency stay the fee denomination.
  const fx = await resolveDrawerAmount(schoolId, { amount, currency: resolvedCurrency, paymentAccountId, asOf: paidOn });
  if (!fx.ok) { res.status(400).json({ error: fx.error }); return; }

  // Allocate the next sequential receipt number for the (school, year)
  const { receiptYear, receiptNumber } = await allocateReceiptNumber(schoolId, paidOn);

  const { data, error } = await supabase.from('fee_payments').insert({
    school_id: schoolId,
    student_fee_id: id,
    amount,
    paid_on: paidOn,
    method: method ?? null,
    reference: reference ?? null,
    notes: notes ?? null,
    unallocated_note: storedUnallocatedNote,
    currency: resolvedCurrency,
    paid_amount: fx.paidAmount,
    paid_currency: fx.paidCurrency,
    exchange_rate: fx.exchangeRate,
    tax_amount: typeof taxAmount === 'number' ? taxAmount : 0,
    tax_label: taxLabel ?? null,
    payment_account_id: paymentAccountId ?? null,
    receipt_year: receiptYear,
    receipt_number: receiptNumber,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  if (allocations && allocations.length > 0) {
    const { error: aErr } = await supabase.from('fee_payment_allocations').insert(
      allocations.map(a => ({
        school_id: schoolId,
        fee_payment_id: data.id,
        fee_installment_id: a.installmentId,
        amount: a.amount,
      })),
    );
    if (aErr) {
      // Roll back the parent payment so the ledger doesn't drift
      await supabase.from('fee_payments').delete().eq('id', data.id);
      res.status(safeDbErrorStatus(aErr)).json({ error: safeDbErrorMessage(aErr) }); return;
    }
  }

  const studentName = (sf as { students?: { full_name?: string } }).students?.full_name;
  await logAudit({ req, entityType: 'fee_payment', entityId: data.id, action: 'create', after: { ...data, allocations }, label: studentName });

  // GL: cash settles the receivable, posted in the drawer's currency (paid_*)
  // so the cash account moves the real amount. Refunds are posted separately.
  await postTuitionPayment({
    schoolId, paymentId: data.id, studentId: (sf as { student_id?: string }).student_id ?? null,
    amount: fx.paidAmount, currency: fx.paidCurrency, paymentAccountId: paymentAccountId ?? null,
    entryDate: paidOn, postedBy: userId,
  });

  // Notify the parent that a payment was recorded
  const parentUserId = (sf as any).students?.parents?.user_id;
  if (parentUserId) {
    await notify({
      schoolId,
      userId: parentUserId,
      type: 'payment_recorded',
      title: 'Tuition payment recorded',
      message: `Payment of ${amount} received`,
      relatedId: data.id,
    });
  }

  res.status(201).json(toCC(data));
}

export async function deletePayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  const { data: before } = await supabase
    .from('fee_payments')
    .select('*, student_fees(students(full_name))')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Payment not found' }); return; }
  // Block voiding a payment whose paid_on falls inside a closed period
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).paid_on]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }
  const { data: after, error } = await supabase
    .from('fee_payments')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const studentName = (before as { student_fees?: { students?: { full_name?: string } } }).student_fees?.students?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.student_fees;
  await logAudit({ req, entityType: 'fee_payment', entityId: String(id), action: 'update', before: beforeRow, after, label: studentName, reason: reason ?? undefined });
  await reverseEntry(schoolId, String(id), { postedBy: userId, memo: 'Payment voided' });
  res.json({ success: true });
}

export async function unvoidPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { data: before } = await supabase
    .from('fee_payments')
    .select('*, student_fees(students(full_name))')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!before || !(before as any).voided_at) { res.status(404).json({ error: 'Voided payment not found' }); return; }
  const periodGuard = await assertPeriodOpen(schoolId, [(before as any).paid_on]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }
  const { data: after, error } = await supabase
    .from('fee_payments')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const studentName = (before as { student_fees?: { students?: { full_name?: string } } }).student_fees?.students?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.student_fees;
  await logAudit({ req, entityType: 'fee_payment', entityId: String(id), action: 'update', before: beforeRow, after, label: studentName });
  await reinstateEntry(schoolId, String(id), { postedBy: req.user!.userId });
  res.json({ success: true });
}

// Refund a previously-recorded payment (full or partial). Stores a separate
// fee_payments row with is_refund=true and refund_of_payment_id pointing back.
// The original row is NOT voided — both stay in history so receipts remain valid.
export async function refundPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // original fee_payment id
  const { amount, refundedOn, method, reference, notes, paymentAccountId } = req.body;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!refundedOn) { res.status(400).json({ error: 'refundedOn is required' }); return; }

  const { data: original } = await supabase
    .from('fee_payments')
    .select('id, school_id, student_fee_id, amount, currency, is_refund, voided_at, student_fees(student_id, students(full_name, parents(user_id)), fee_plans(kind))')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!original) { res.status(404).json({ error: 'Original payment not found' }); return; }
  if ((original as any).is_refund) { res.status(400).json({ error: 'Cannot refund a refund' }); return; }
  if ((original as any).voided_at) { res.status(400).json({ error: 'Cannot refund a voided payment — unvoid it first' }); return; }

  // Cap refund at original − sum of prior non-voided refunds against it
  const { data: prior } = await supabase
    .from('fee_payments')
    .select('amount')
    .eq('school_id', schoolId)
    .eq('refund_of_payment_id', id)
    .is('voided_at', null);
  const priorSum = (prior ?? []).reduce((s, p: any) => s + Number(p.amount), 0);
  const refundable = Number((original as any).amount) - priorSum;
  if (amount > refundable + 0.01) {
    res.status(400).json({ error: `Refund exceeds remaining refundable amount (${refundable.toFixed(2)})` });
    return;
  }

  const periodGuard = await assertPeriodOpen(schoolId, [refundedOn]);
  if (!periodGuard.ok) { res.status(periodGuard.status).json({ error: periodGuard.error }); return; }

  const refundCurrency = (original as any).currency ?? 'USD';
  // Convert the refund into the drawer's currency (cash leaving the drawer).
  const fx = await resolveDrawerAmount(schoolId, { amount, currency: refundCurrency, paymentAccountId, asOf: refundedOn });
  if (!fx.ok) { res.status(400).json({ error: fx.error }); return; }

  const { receiptYear, receiptNumber } = await allocateReceiptNumber(schoolId, refundedOn);

  const { data: refund, error } = await supabase.from('fee_payments').insert({
    school_id: schoolId,
    student_fee_id: (original as any).student_fee_id,
    amount,
    paid_on: refundedOn,
    method: method ?? null,
    reference: reference ?? null,
    notes: notes ?? null,
    currency: refundCurrency,
    paid_amount: fx.paidAmount,
    paid_currency: fx.paidCurrency,
    exchange_rate: fx.exchangeRate,
    is_refund: true,
    refund_of_payment_id: id,
    payment_account_id: paymentAccountId ?? null,
    receipt_year: receiptYear,
    receipt_number: receiptNumber,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const studentName = ((original as any).student_fees?.students?.full_name) as string | undefined;
  await logAudit({ req, entityType: 'fee_payment', entityId: refund.id, action: 'create', after: refund, label: studentName, reason: `Refund of ${id}` });

  // GL: Dr Accounts Receivable / Cr Cash — restores the receivable (keeps AR in
  // step with the tuition module), rather than reducing income.
  await postRefund({
    schoolId, refundId: refund.id,
    studentId: (original as any).student_fees?.student_id ?? null,
    amount: fx.paidAmount, currency: fx.paidCurrency,
    paymentAccountId: paymentAccountId ?? null, entryDate: refundedOn, postedBy: userId,
  });

  const parentUserId = (original as any).student_fees?.students?.parents?.user_id;
  if (parentUserId) {
    await notify({
      schoolId,
      userId: parentUserId,
      type: 'payment_recorded',
      title: 'Refund issued',
      message: `Refund of ${amount} issued`,
      relatedId: refund.id,
    });
  }

  res.status(201).json(toCC(refund));
}

// ── Late fees ──────────────────────────────────────────────────────────
// The pg_cron job apply_late_fees() auto-inserts one row per overdue
// installment per plan with late_fee_enabled. Admin/accountant can void
// individual late fees (e.g. waived for a hardship). Once voided they don't
// re-apply because the UNIQUE(student_fee_id, fee_installment_id) index
// keeps the row in place.

export async function listLateFees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const studentFeeId = (req.query.studentFeeId as string | undefined) ?? null;
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  // Keyset on (applied_on DESC, id DESC). id is the unique tiebreak keyset
  // pagination requires — late fees applied in the same nightly run share
  // an applied_on date.
  let q = supabase
    .from('student_fee_late_fees')
    .select('id, student_fee_id, fee_installment_id, amount, applied_on, voided_at, void_reason, created_at, fee_installments(sequence, due_date)')
    .eq('school_id', schoolId)
    .order('applied_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (studentFeeId) q = q.eq('student_fee_id', studentFeeId);
  if (cursor) q = q.or(keysetAfter('applied_on', cursor));
  const { data, error } = await q;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const page = buildPageWith(
    ((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })),
    limit,
    r => r.applied_on as string,
  );
  res.json({ data: page.data.map(toCC), limit: page.limit, nextCursor: page.nextCursor });
}

export async function voidLateFee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const reason = (req.body?.reason as string | undefined)?.trim() || null;
  const { data: before } = await supabase.from('student_fee_late_fees').select('*').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!before) { res.status(404).json({ error: 'Late fee not found' }); return; }
  const { data: after, error } = await supabase
    .from('student_fee_late_fees')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'late_fee', entityId: String(id), action: 'update', before, after, reason: reason ?? undefined });
  // GL: reverse the late-fee accrual (posted from apply_late_fees, keyed on late-fee id).
  await reverseEntry(schoolId, String(id), { postedBy: userId, memo: 'Late fee voided' });
  res.json({ success: true });
}

// Manually trigger late-fee application (debug / admin "run now" button).
// The pg_cron job runs nightly; this lets a school force a refresh after
// editing a plan's late-fee config.
export async function applyLateFeesNow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }
  const { error } = await supabase.rpc('apply_late_fees');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

export async function listVoidedPayments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  let q = supabase
    .from('fee_payments')
    .select('id, amount, paid_on, method, reference, notes, voided_at, voided_by, void_reason, student_fee_id, student_fees(students(id, full_name), fee_plans(name, currency))')
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
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      voidedAt: p.voided_at,
      voidReason: p.void_reason,
      voidedByName: p.voided_by ? nameByUser.get(p.voided_by) ?? null : null,
      studentFeeId: p.student_fee_id,
      studentId: p.student_fees?.students?.id ?? null,
      studentName: p.student_fees?.students?.full_name ?? null,
      planName: p.student_fees?.fee_plans?.name ?? null,
      currency: p.student_fees?.fee_plans?.currency ?? 'USD',
    })),
    limit: page.limit,
    nextCursor: page.nextCursor,
  });
}

// ── Adjustments (admin only) ────────────────────────────────────────────

export async function updateStudentFee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { adjustment, notes, totalAmount } = req.body;
  const upd: Record<string, unknown> = {};
  if (typeof adjustment === 'number') upd.adjustment = adjustment;
  if (typeof notes === 'string' || notes === null) upd.notes = notes;
  if (typeof totalAmount === 'number' && totalAmount >= 0) upd.total_amount = totalAmount;

  const { data: before } = await supabase.from('student_fees')
    .select('*, students(full_name)').eq('id', id).eq('school_id', schoolId).single();

  const { error } = await supabase.from('student_fees').update(upd).eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const { data: after } = await supabase.from('student_fees').select('*').eq('id', id).eq('school_id', schoolId).single();
  const studentName = (before as { students?: { full_name?: string } } | null)?.students?.full_name;
  if (before) {
    const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
    delete beforeRow.students;
    await logAudit({ req, entityType: 'student_fee', entityId: String(id), action: 'update', before: beforeRow, after: after || undefined, label: studentName });
  }
  res.json({ success: true });
}

// ── Bootstrap data for the Plans tab: class list + school's current academic year.
// Accountants don't have access to /admin/classes (which is gated to admin/teacher),
// so the accounting module gets its own endpoint that returns both pieces.
export async function getAccountingSetup(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const [classesRes, currentAcademicYear] = await Promise.all([
    supabase.from('classes').select('id, name, grade_level').eq('school_id', schoolId).order('name'),
    resolveCurrentAcademicYear(schoolId),
  ]);

  if (classesRes.error) { res.status(500).json({ error: classesRes.error.message }); return; }

  res.json({
    classes: toCC(classesRes.data || []),
    currentAcademicYear,
  });
}

// ── Tuition config (admin only) ────────────────────────────────────────

export async function getConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  res.json(await getTuitionConfig(schoolId));
}

export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const body = req.body as Partial<TuitionConfig>;
  const current = await getTuitionConfig(schoolId);
  const next: TuitionConfig = {
    currency: typeof body.currency === 'string' && body.currency.length >= 1 && body.currency.length <= 8 ? body.currency : current.currency,
    siblingDiscount: body.siblingDiscount ?? current.siblingDiscount,
  };
  // Sanitize sibling discount tiers
  if (Array.isArray(next.siblingDiscount.tiers)) {
    next.siblingDiscount.tiers = next.siblingDiscount.tiers
      .filter(t => typeof t.minSiblings === 'number' && typeof t.value === 'number' && t.minSiblings >= 2 && t.value >= 0)
      .map(t => ({ minSiblings: Math.floor(t.minSiblings), value: Number(t.value) }));
  } else {
    next.siblingDiscount.tiers = [];
  }
  if (!['percent', 'fixed'].includes(next.siblingDiscount.type)) next.siblingDiscount.type = 'percent';

  const { error } = await supabase.from('schools').update({ tuition_config: next }).eq('id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(next);
}

// ── Broadcast (admin only) — notify everyone who isn't paid up ──────────

export async function notifyDue(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { title, message, statusFilter } = req.body as { title?: string; message?: string; statusFilter?: Status[] };
  const allowed: Status[] = Array.isArray(statusFilter) && statusFilter.length
    ? statusFilter.filter((s): s is Status => ['current', 'due_soon', 'overdue'].includes(s))
    : ['current', 'due_soon', 'overdue'];

  const rows = await buildStudentFeeRows(schoolId);
  // Collect parent userIds whose children have any non-paid_up fee in the allowed set
  const userIds = new Set<string>();
  for (const r of rows) {
    if (allowed.includes(r.status) && r.parentUserId) userIds.add(r.parentUserId);
  }
  if (userIds.size === 0) { res.json({ notified: 0 }); return; }

  const finalTitle = title?.trim() || 'Tuition payment reminder';
  const finalMessage = message?.trim() || 'A tuition payment is due. Please contact the school for details.';
  await notifyMany(Array.from(userIds).map(userId => ({
    schoolId,
    userId,
    type: 'fees_reminder',
    title: finalTitle,
    message: finalMessage,
  })));
  res.json({ notified: userIds.size });
}

// ── Locks (admin only) ──────────────────────────────────────────────────

const LOCKABLE = ['grades', 'reports'];

export async function setLock(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.params;
  const { feature, reason } = req.body as { feature: string; reason?: string };
  if (!LOCKABLE.includes(feature)) { res.status(400).json({ error: 'Unsupported feature' }); return; }

  // Verify student belongs to this school
  const { data: stu } = await supabase.from('students').select('id').eq('id', studentId).eq('school_id', schoolId).single();
  if (!stu) { res.status(404).json({ error: 'Student not found' }); return; }

  const { error } = await supabase.from('student_access_locks').upsert({
    school_id: schoolId,
    student_id: studentId,
    feature,
    reason: reason ?? null,
    locked_by: userId,
    locked_at: new Date().toISOString(),
  }, { onConflict: 'student_id,feature' });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

export async function removeLock(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { studentId, feature } = req.params;
  const { error } = await supabase
    .from('student_access_locks').delete()
    .eq('school_id', schoolId).eq('student_id', studentId).eq('feature', feature);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ── Receipts ────────────────────────────────────────────────────────────

// AC-2 — find a payment inside the frozen archived_students.payment_history
// snapshot when the live fee_payments row is gone (student was archived).
// Searches by payment id; on miss, by (receiptYear, receiptNumber). The
// archived snapshot includes every receipt field we need (per migration 041 +
// the staff parity work in PR B) so the receipt regenerates without touching
// the deleted live tables.
interface ArchivedReceiptHit {
  archive: {
    id: string;
    schoolId: string;
    studentName: string;
    parentName: string | null;
    originalParentId: string | null;
  };
  studentFee: {
    studentFeeId: string;
    planName: string;
    academicYear: string | null;
    currency: string;
    totalAmount: number;
    adjustment: number;
    siblingDiscount: number;
  };
  payment: {
    id: string;
    amount: number;
    paidOn: string;
    method: string | null;
    reference: string | null;
    notes: string | null;
    receiptYear: number | null;
    receiptNumber: number | null;
    taxAmount: number | null;
    taxLabel: string | null;
    paymentAccountId: string | null;
    isRefund: boolean;
  };
}

function projectArchive(row: any): ArchivedReceiptHit['archive'] {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentName: row.full_name ?? '—',
    parentName: row.parent_full_name ?? null,
    originalParentId: row.original_parent_id ?? null,
  };
}

function projectStudentFee(sf: any): ArchivedReceiptHit['studentFee'] {
  return {
    studentFeeId: String(sf.studentFeeId ?? ''),
    planName: sf.planName ?? '—',
    academicYear: sf.academicYear ?? null,
    currency: sf.currency ?? 'USD',
    totalAmount: Number(sf.totalAmount ?? 0),
    adjustment: Number(sf.adjustment ?? 0),
    siblingDiscount: Number(sf.siblingDiscount ?? 0),
  };
}

function projectPayment(p: any): ArchivedReceiptHit['payment'] {
  return {
    id: String(p.id ?? ''),
    amount: Number(p.amount ?? 0),
    paidOn: String(p.paidOn ?? ''),
    method: p.method ?? null,
    reference: p.reference ?? null,
    notes: p.notes ?? null,
    receiptYear: p.receiptYear != null ? Number(p.receiptYear) : null,
    receiptNumber: p.receiptNumber != null ? Number(p.receiptNumber) : null,
    taxAmount: p.taxAmount != null ? Number(p.taxAmount) : null,
    taxLabel: p.taxLabel ?? null,
    paymentAccountId: p.paymentAccountId ?? null,
    isRefund: Boolean(p.isRefund),
  };
}

async function findArchivedPaymentById(
  schoolId: string, paymentId: string,
): Promise<ArchivedReceiptHit | null> {
  const { data } = await supabase
    .from('archived_students')
    .select('id, school_id, full_name, parent_full_name, original_parent_id, payment_history')
    .eq('school_id', schoolId);
  for (const row of (data ?? []) as any[]) {
    const history = Array.isArray(row.payment_history) ? row.payment_history : [];
    for (const sf of history) {
      const payments = Array.isArray(sf.payments) ? sf.payments : [];
      const hit = payments.find((p: any) => String(p.id) === paymentId);
      if (hit) {
        return {
          archive: projectArchive(row),
          studentFee: projectStudentFee(sf),
          payment: projectPayment(hit),
        };
      }
    }
  }
  return null;
}

async function findArchivedStudentFeeById(
  schoolId: string, studentFeeId: string,
): Promise<{ archive: ArchivedReceiptHit['archive']; studentFee: ArchivedReceiptHit['studentFee']; payments: ArchivedReceiptHit['payment'][] } | null> {
  const { data } = await supabase
    .from('archived_students')
    .select('id, school_id, full_name, parent_full_name, original_parent_id, payment_history')
    .eq('school_id', schoolId);
  for (const row of (data ?? []) as any[]) {
    const history = Array.isArray(row.payment_history) ? row.payment_history : [];
    const sf = history.find((s: any) => String(s.studentFeeId) === studentFeeId);
    if (sf) {
      const payments = (Array.isArray(sf.payments) ? sf.payments : []).map(projectPayment);
      return {
        archive: projectArchive(row),
        studentFee: projectStudentFee(sf),
        payments,
      };
    }
  }
  return null;
}

// Render a single archived payment as a receipt PDF. Allocation breakdown
// is omitted — the snapshot doesn't capture per-installment allocations
// (they cascaded with the live fee_payment_allocations rows). The total
// goes into the "unallocated" line, which is honest about the gap.
async function streamArchivedPaymentReceipt(
  res: Response, schoolId: string, hit: ArchivedReceiptHit,
): Promise<void> {
  const { data: school } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).single();
  if (!school) { res.status(404).json({ error: 'School not found' }); return; }
  const receiptNumber = hit.payment.receiptYear != null && hit.payment.receiptNumber != null
    ? `RCP-${hit.payment.receiptYear}-${String(hit.payment.receiptNumber).padStart(5, '0')}`
    : `FEE-${hit.payment.id.slice(0, 8).toUpperCase()}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${receiptNumber}.pdf"`);
  await streamPaymentReceipt(res, {
    school: { name: (school as any).name, logoUrl: (school as any).logo_url ?? null },
    parentName: hit.archive.parentName ?? '—',
    studentName: hit.archive.studentName,
    planName: hit.studentFee.planName,
    academicYear: hit.studentFee.academicYear,
    currency: hit.studentFee.currency,
    receiptNumber,
    paidOn: hit.payment.paidOn,
    amount: hit.payment.amount,
    method: hit.payment.method,
    reference: hit.payment.reference,
    notes: hit.payment.notes,
    taxAmount: hit.payment.taxAmount ?? 0,
    taxLabel: hit.payment.taxLabel,
    totalAmount: hit.studentFee.totalAmount,
    adjustment: hit.studentFee.adjustment,
    siblingDiscount: hit.studentFee.siblingDiscount,
    paidBefore: 0,
    recorderName: null,
    allocations: [],
    unallocatedAmount: hit.payment.amount,
    unallocatedNote: null,
  });
}

// Render an archived student_fee's full payment history as the year-summary
// PDF. Same allocation caveat as the single-receipt variant.
async function streamArchivedYearSummary(
  res: Response, schoolId: string,
  hit: { archive: ArchivedReceiptHit['archive']; studentFee: ArchivedReceiptHit['studentFee']; payments: ArchivedReceiptHit['payment'][] },
): Promise<void> {
  const { data: school } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).single();
  if (!school) { res.status(404).json({ error: 'School not found' }); return; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="tuition-statement-${hit.studentFee.studentFeeId.slice(0, 8)}.pdf"`);
  await streamYearSummary(res, {
    school: { name: (school as any).name, logoUrl: (school as any).logo_url ?? null },
    parentName: hit.archive.parentName ?? '—',
    studentName: hit.archive.studentName,
    planName: hit.studentFee.planName,
    academicYear: hit.studentFee.academicYear,
    currency: hit.studentFee.currency,
    totalAmount: hit.studentFee.totalAmount,
    adjustment: hit.studentFee.adjustment,
    siblingDiscount: hit.studentFee.siblingDiscount,
    payments: hit.payments
      .filter(p => !p.isRefund)
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn))
      .map(p => ({
        id: p.id,
        paidOn: p.paidOn,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        recorderName: null,
        allocations: [],
        unallocatedAmount: p.amount,
        unallocatedNote: null,
      })),
  });
}

// Parent visibility on an archived snapshot — the live student_fees row is
// gone, so we authorize via the snapshot's original_parent_id pointer.
// Admin/accountant always allowed (school-scoped). (Reception removed 2026-06-30.)
async function authorizeArchivedReceipt(
  req: AuthRequest, archive: ArchivedReceiptHit['archive'],
): Promise<{ ok: boolean }> {
  const { schoolId, userId, role } = req.user!;
  if (archive.schoolId !== schoolId) return { ok: false };
  if (role === 'admin' || role === 'accountant') return { ok: true };
  if (role === 'parent') {
    if (!archive.originalParentId) return { ok: false };
    const { data } = await supabase
      .from('parents').select('user_id').eq('id', archive.originalParentId).eq('school_id', schoolId).maybeSingle();
    if ((data as { user_id?: string } | null)?.user_id === userId) return { ok: true };
  }
  return { ok: false };
}

async function loadReceiptContext(schoolId: string, studentFeeId: string) {
  const cfg = await getTuitionConfig(schoolId);
  const { data: sf } = await supabase
    .from('student_fees')
    .select(`
      id, total_amount, adjustment, fee_plan_id,
      students!inner(id, full_name, parent_id, parents(id, full_name)),
      fee_plans!inner(id, name, currency, academic_year)
    `)
    .eq('id', studentFeeId).eq('school_id', schoolId).single();
  if (!sf) return null;
  const { data: school } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).single();
  if (!school) return null;

  // Sibling count: same parent + same academic_year
  const academicYear = (sf as any).fee_plans?.academic_year ?? null;
  const parentId = (sf as any).students?.parent_id ?? null;
  let siblings = 1;
  if (parentId) {
    const { data: peers } = await supabase
      .from('student_fees')
      .select('student_id, students!inner(parent_id), fee_plans!inner(academic_year)')
      .eq('school_id', schoolId);
    const ids = new Set<string>();
    for (const r of (peers ?? []) as any[]) {
      if (r.students?.parent_id === parentId && (r.fee_plans?.academic_year ?? null) === academicYear) {
        ids.add(r.student_id);
      }
    }
    siblings = Math.max(1, ids.size);
  }
  const totalAmount = Number((sf as any).total_amount);
  const adjustment = Number((sf as any).adjustment);
  const siblingDiscount = computeSiblingDiscount(totalAmount, siblings, cfg.siblingDiscount);

  return {
    schoolInfo: { name: (school as any).name, logoUrl: (school as any).logo_url ?? null },
    parentName: (sf as any).students?.parents?.full_name ?? '—',
    studentName: (sf as any).students?.full_name ?? '—',
    planName: (sf as any).fee_plans?.name ?? '—',
    academicYear,
    currency: (sf as any).fee_plans?.currency ?? cfg.currency,
    totalAmount,
    adjustment,
    siblingDiscount,
  };
}

// Verifies the requesting user can see this payment.
// admin/accountant: their school. parent: must own the student. (Reception removed 2026-06-30.)
async function authorizeReceipt(req: AuthRequest, studentFeeId: string): Promise<{ ok: boolean }> {
  const { schoolId, userId, role } = req.user!;
  const { data: sf } = await supabase
    .from('student_fees')
    .select('school_id, students!inner(parents(user_id))')
    .eq('id', studentFeeId).single();
  if (!sf || (sf as any).school_id !== schoolId) return { ok: false };
  if (role === 'admin' || role === 'accountant') return { ok: true };
  if (role === 'parent') {
    const parentUserId = (sf as any).students?.parents?.user_id;
    if (parentUserId === userId) return { ok: true };
  }
  return { ok: false };
}

export async function paymentReceiptPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = String(req.params.id); // payment id

  const { data: payment } = await supabase
    .from('fee_payments').select('id, student_fee_id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at, receipt_year, receipt_number, tax_amount, tax_label')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).maybeSingle();

  // AC-2 — Live payment is gone (student archived). Fall back to the frozen
  // snapshot on archived_students.payment_history so receipts can still be
  // reissued. Authorization here keys on the archive's original_parent_id
  // (the live student_fees row no longer exists for the parent check).
  if (!payment) {
    const hit = await findArchivedPaymentById(schoolId, id);
    if (!hit) { res.status(404).json({ error: 'Payment not found' }); return; }
    const auth = await authorizeArchivedReceipt(req, hit.archive);
    if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }
    await streamArchivedPaymentReceipt(res, schoolId, hit);
    return;
  }

  // Canonical receipt number is RCP-YYYY-NNNNN (sequential per school, per
  // calendar year — see CLAUDE.md). Fall back to a UUID-derived ID only for
  // payments recorded before migration 009 introduced these columns.
  const formattedReceiptNumber = (payment as any).receipt_year != null && (payment as any).receipt_number != null
    ? `RCP-${(payment as any).receipt_year}-${String((payment as any).receipt_number).padStart(5, '0')}`
    : `FEE-${String((payment as any).id).slice(0, 8).toUpperCase()}`;

  const auth = await authorizeReceipt(req, (payment as any).student_fee_id);
  if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ctx = await loadReceiptContext(schoolId, (payment as any).student_fee_id);
  if (!ctx) { res.status(404).json({ error: 'Not found' }); return; }

  // Sum of payments BEFORE this one — refunds subtract (audit H-2)
  const { data: priorRows } = await supabase
    .from('fee_payments').select('amount, created_at, is_refund')
    .eq('student_fee_id', (payment as any).student_fee_id)
    .is('voided_at', null)
    .lt('created_at', (payment as any).created_at ?? new Date().toISOString());
  const paidBefore = (priorRows ?? []).reduce((s, p) => s + ((p as any).is_refund ? -1 : 1) * Number((p as any).amount), 0);

  // Allocation breakdown for this specific payment
  const { data: allocs } = await supabase
    .from('fee_payment_allocations')
    .select('amount, fee_installments(sequence, due_date)')
    .eq('fee_payment_id', (payment as any).id);
  const allocations = (allocs ?? []).map((a: any) => ({
    sequence: a.fee_installments?.sequence ?? 0,
    dueDate: a.fee_installments?.due_date ?? '',
    amount: Number(a.amount),
  })).sort((a, b) => a.sequence - b.sequence);

  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  const paymentAmount = Number((payment as any).amount);
  const unallocatedAmount = allocations.length > 0
    ? Math.max(0, Math.round((paymentAmount - allocSum) * 100) / 100)
    : 0;

  // Recorder full name (name only — never username, per accountant-attribution requirement)
  let recorderName: string | null = null;
  if ((payment as any).recorded_by) {
    const { data: u } = await supabase.from('users').select('first_name, last_name').eq('id', (payment as any).recorded_by).single();
    if (u) {
      const joined = `${(u as any).first_name ?? ''} ${(u as any).last_name ?? ''}`.trim();
      recorderName = joined || null;
    }
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${formattedReceiptNumber}.pdf"`);
  await streamPaymentReceipt(res, {
    school: ctx.schoolInfo,
    parentName: ctx.parentName,
    studentName: ctx.studentName,
    planName: ctx.planName,
    academicYear: ctx.academicYear,
    currency: ctx.currency,
    receiptNumber: formattedReceiptNumber,
    paidOn: (payment as any).paid_on,
    amount: paymentAmount,
    method: (payment as any).method,
    reference: (payment as any).reference,
    notes: (payment as any).notes,
    taxAmount: (payment as any).tax_amount != null ? Number((payment as any).tax_amount) : 0,
    taxLabel: (payment as any).tax_label ?? null,
    totalAmount: ctx.totalAmount,
    adjustment: ctx.adjustment,
    siblingDiscount: ctx.siblingDiscount,
    paidBefore,
    recorderName,
    allocations,
    unallocatedAmount,
    unallocatedNote: (payment as any).unallocated_note ?? null,
  });
}

export async function studentFeeSummaryPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const id = req.params.id as string; // student_fee id

  // AC-2 — when the live student_fees row is gone (student archived), serve
  // the year summary from the frozen archived_students.payment_history
  // snapshot. The live auth check joins through student_fees, so we have to
  // re-authorize in the archived path.
  const ctx = await loadReceiptContext(schoolId, id);
  if (!ctx) {
    const hit = await findArchivedStudentFeeById(schoolId, id);
    if (!hit) { res.status(404).json({ error: 'Not found' }); return; }
    const archAuth = await authorizeArchivedReceipt(req, hit.archive);
    if (!archAuth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }
    await streamArchivedYearSummary(res, schoolId, hit);
    return;
  }

  const auth = await authorizeReceipt(req, id);
  if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { data: payments } = await supabase
    .from('fee_payments')
    .select('id, amount, paid_on, method, reference, unallocated_note, recorded_by')
    .eq('student_fee_id', id)
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .order('paid_on', { ascending: true });

  const paymentIds = (payments ?? []).map(p => (p as any).id);
  const recorderIds = Array.from(new Set((payments ?? []).map(p => (p as any).recorded_by).filter(Boolean)));
  const [{ data: allocs }, { data: users }] = await Promise.all([
    paymentIds.length
      ? supabase
          .from('fee_payment_allocations')
          .select('fee_payment_id, amount, fee_installments(sequence, due_date)')
          .in('fee_payment_id', paymentIds)
      : Promise.resolve({ data: [] as any[] }),
    recorderIds.length
      ? supabase.from('users').select('id, first_name, last_name').in('id', recorderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const allocsByPayment = new Map<string, { sequence: number; dueDate: string; amount: number }[]>();
  for (const a of (allocs ?? []) as any[]) {
    const arr = allocsByPayment.get(a.fee_payment_id) ?? [];
    arr.push({
      sequence: a.fee_installments?.sequence ?? 0,
      dueDate: a.fee_installments?.due_date ?? '',
      amount: Number(a.amount),
    });
    allocsByPayment.set(a.fee_payment_id, arr);
  }
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="tuition-statement-${id.slice(0, 8)}.pdf"`);
  await streamYearSummary(res, {
    school: ctx.schoolInfo,
    parentName: ctx.parentName,
    studentName: ctx.studentName,
    planName: ctx.planName,
    academicYear: ctx.academicYear,
    currency: ctx.currency,
    totalAmount: ctx.totalAmount,
    adjustment: ctx.adjustment,
    siblingDiscount: ctx.siblingDiscount,
    payments: (payments ?? []).map(p => {
      const sortedAllocs = (allocsByPayment.get((p as any).id) ?? []).sort((a, b) => a.sequence - b.sequence);
      const allocSum = sortedAllocs.reduce((s, a) => s + a.amount, 0);
      const paymentAmount = Number((p as any).amount);
      const unallocatedAmount = sortedAllocs.length > 0
        ? Math.max(0, Math.round((paymentAmount - allocSum) * 100) / 100)
        : 0;
      return {
        id: (p as any).id,
        paidOn: (p as any).paid_on,
        amount: paymentAmount,
        method: (p as any).method,
        reference: (p as any).reference,
        recorderName: (p as any).recorded_by ? nameByUser.get((p as any).recorded_by) ?? null : null,
        allocations: sortedAllocs,
        unallocatedAmount,
        unallocatedNote: (p as any).unallocated_note ?? null,
      };
    }),
  });
}

// ── Parent endpoint ─────────────────────────────────────────────────────

export async function getParentFees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.json([]); return; }

  // Get parent's student ids
  const { data: kids } = await supabase.from('students').select('id').eq('parent_id', (parent as any).id).eq('school_id', schoolId);
  const studentIds = (kids ?? []).map(s => (s as any).id);
  if (studentIds.length === 0) { res.json([]); return; }

  const all = await buildStudentFeeRows(schoolId);
  const mine = all.filter(r => studentIds.includes(r.studentId));

  // Attach payments per student_fee.
  // HD-7 — surface refund + voided rows to parents so the payment list is
  // truthful. is_refund / refund_of_payment_id pair to the original (which
  // is still visible too); voided_at + void_reason render the row as a
  // strike-through so a refunded school year reads correctly. The family
  // rollup totals come from buildStudentFeeRows() which already handles
  // void/refund signs — this section only changes what the list shows.
  const sfIds = mine.map(r => r.id);
  const { data: payments } = await supabase
    .from('fee_payments')
    .select('id, student_fee_id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at, is_refund, refund_of_payment_id, voided_at, void_reason, receipt_year, receipt_number')
    .in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000'])
    .order('paid_on', { ascending: false });

  const paymentIds = (payments ?? []).map(p => (p as any).id);
  const recorderIds = Array.from(new Set((payments ?? []).map(p => (p as any).recorded_by).filter(Boolean)));
  const [{ data: allocs }, { data: users }] = await Promise.all([
    paymentIds.length
      ? supabase
          .from('fee_payment_allocations')
          .select('fee_payment_id, fee_installment_id, amount, fee_installments(sequence, due_date)')
          .in('fee_payment_id', paymentIds)
      : Promise.resolve({ data: [] as any[] }),
    recorderIds.length
      ? supabase.from('users').select('id, first_name, last_name').in('id', recorderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const allocsByPayment = new Map<string, any[]>();
  for (const a of (allocs ?? []) as any[]) {
    const arr = allocsByPayment.get(a.fee_payment_id) ?? [];
    arr.push({
      installmentId: a.fee_installment_id,
      amount: Number(a.amount),
      sequence: a.fee_installments?.sequence ?? null,
      dueDate: a.fee_installments?.due_date ?? null,
    });
    allocsByPayment.set(a.fee_payment_id, arr);
  }
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }

  const paysBySf = new Map<string, any[]>();
  for (const p of payments ?? []) {
    const arr = paysBySf.get((p as any).student_fee_id) ?? [];
    const sortedAllocs = (allocsByPayment.get((p as any).id) ?? []).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const allocSum = sortedAllocs.reduce((s, a) => s + a.amount, 0);
    const unallocatedAmount = Math.round((Number((p as any).amount) - allocSum) * 100) / 100;
    arr.push({
      id: (p as any).id,
      amount: Number((p as any).amount),
      paidOn: (p as any).paid_on,
      method: (p as any).method,
      reference: (p as any).reference,
      notes: (p as any).notes,
      unallocatedNote: (p as any).unallocated_note ?? null,
      unallocatedAmount: sortedAllocs.length > 0 && unallocatedAmount > 0 ? unallocatedAmount : 0,
      recorderName: (p as any).recorded_by ? nameByUser.get((p as any).recorded_by) ?? null : null,
      allocations: sortedAllocs,
      createdAt: (p as any).created_at,
      // HD-7 — markers the parent UI renders as badges / strike-through.
      isRefund: Boolean((p as any).is_refund),
      refundOfPaymentId: (p as any).refund_of_payment_id ?? null,
      voidedAt: (p as any).voided_at ?? null,
      voidReason: (p as any).void_reason ?? null,
      receiptYear: (p as any).receipt_year ?? null,
      receiptNumber: (p as any).receipt_number ?? null,
    });
    paysBySf.set((p as any).student_fee_id, arr);
  }

  res.json(mine.map(r => ({ ...r, payments: paysBySf.get(r.id) ?? [] })));
}

// ── Archive (graduated + archived students) ────────────────────────────
//
// Graduated students still live in `students` with is_graduated=true, so their
// student_fees / fee_payments rows are intact and queried live.
//
// Archived students were copied into `archived_students` and the original row
// was hard-deleted, which cascades fee_payments away. From migration 008
// onward, archived_students.payment_history holds a JSONB snapshot taken at
// archive time. Older archived rows have an empty array.
//
// Both kinds are surfaced via the same endpoints. The route param `:kind`
// (archived | graduated) tells the controller which source to read.

interface ArchiveListItem {
  kind: 'archived' | 'graduated';
  id: string;
  fullName: string;
  className: string | null;
  parentName: string | null;
  parentPhone: string | null;
  date: string | null; // departure_date for archived, null for graduated
  reason: string | null;
  totalDue: number;
  totalPaid: number;
  balance: number;
  currency: string;
}

function plansFromSnapshot(snapshot: any): ArchivePlanEntry[] {
  const arr = Array.isArray(snapshot) ? snapshot : [];
  return arr.map((sf: any) => ({
    planName: sf.planName ?? 'Plan',
    academicYear: sf.academicYear ?? null,
    currency: sf.currency ?? 'USD',
    totalAmount: Number(sf.totalAmount ?? 0),
    adjustment: Number(sf.adjustment ?? 0),
    payments: Array.isArray(sf.payments) ? sf.payments.map((p: any) => ({
      amount: Number(p.amount ?? 0),
      paidOn: p.paidOn ?? '',
      method: p.method ?? null,
      reference: p.reference ?? null,
      notes: p.notes ?? null,
      // Snapshots since migration 008 store isRefund per payment (see
      // admin.controller buildStudentArchiveSnapshot); older ones lack it,
      // in which case treating rows as payments matches the old behavior.
      isRefund: Boolean(p.isRefund),
    })) : [],
  }));
}

async function plansFromGraduated(schoolId: string, studentId: string): Promise<ArchivePlanEntry[]> {
  const { data: sfs } = await supabase
    .from('student_fees')
    .select('id, total_amount, adjustment, fee_plans(name, currency, academic_year)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId);
  const sfIds = (sfs ?? []).map((s: any) => s.id);
  const { data: pays } = sfIds.length
    ? await supabase
        .from('fee_payments')
        .select('student_fee_id, amount, paid_on, method, reference, notes, is_refund')
        .in('student_fee_id', sfIds)
        .is('voided_at', null)
        .order('paid_on', { ascending: true })
    : { data: [] as any[] };
  const paysBySf = new Map<string, any[]>();
  for (const p of pays ?? []) {
    const arr = paysBySf.get((p as any).student_fee_id) ?? [];
    arr.push({
      amount: Number((p as any).amount),
      paidOn: (p as any).paid_on,
      method: (p as any).method ?? null,
      reference: (p as any).reference ?? null,
      notes: (p as any).notes ?? null,
      isRefund: Boolean((p as any).is_refund),
    });
    paysBySf.set((p as any).student_fee_id, arr);
  }
  return (sfs ?? []).map((sf: any) => ({
    planName: sf.fee_plans?.name ?? 'Plan',
    academicYear: sf.fee_plans?.academic_year ?? null,
    currency: sf.fee_plans?.currency ?? 'USD',
    totalAmount: Number(sf.total_amount),
    adjustment: Number(sf.adjustment),
    payments: paysBySf.get(sf.id) ?? [],
  }));
}

function summarisePlans(plans: ArchivePlanEntry[]): { totalDue: number; totalPaid: number; balance: number; currency: string } {
  let totalDue = 0, totalPaid = 0;
  for (const p of plans) {
    totalDue += p.totalAmount + p.adjustment;
    totalPaid += netPaid(p.payments); // refunds subtract (audit H-2)
  }
  return {
    totalDue,
    totalPaid,
    balance: Math.max(0, totalDue - totalPaid),
    currency: plans[0]?.currency ?? 'USD',
  };
}

export async function listArchivePaymentRecords(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const search = (req.query.search as string | undefined)?.trim().toLowerCase() ?? '';

  // Archived
  const { data: archivedRows } = await supabase
    .from('archived_students')
    .select('id, full_name, departure_date, reason, parent_full_name, parent_phone, enrollment_history, classes_attended, payment_history, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  const archived: ArchiveListItem[] = (archivedRows ?? []).map((r: any) => {
    const plans = plansFromSnapshot(r.payment_history);
    const sum = summarisePlans(plans);
    // Prefer enrollment_history (migration 030); fall back to the legacy
    // classes_attended JSONB for pre-backfill archives.
    const history = Array.isArray(r.enrollment_history) ? r.enrollment_history : [];
    const legacy = Array.isArray(r.classes_attended) ? r.classes_attended : [];
    const lastClass = history.length
      ? (history[history.length - 1]?.className ?? history[history.length - 1]?.gradeLevel ?? null)
      : (legacy.length ? (legacy[legacy.length - 1]?.className ?? null) : null);
    return {
      kind: 'archived',
      id: r.id,
      fullName: r.full_name,
      className: lastClass,
      parentName: r.parent_full_name ?? null,
      parentPhone: r.parent_phone ?? null,
      date: r.departure_date ?? null,
      reason: r.reason ?? null,
      ...sum,
    };
  });

  // Graduated
  const { data: gradRows } = await supabase
    .from('students')
    .select('id, full_name, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('full_name');

  const gradIds = (gradRows ?? []).map((g: any) => g.id);
  const { data: gradSfs } = gradIds.length
    ? await supabase
        .from('student_fees')
        .select('id, student_id, total_amount, adjustment, fee_plans(name, currency, academic_year)')
        .in('student_id', gradIds)
    : { data: [] as any[] };

  const gradSfIds = (gradSfs ?? []).map((s: any) => s.id);
  const { data: gradPays } = gradSfIds.length
    ? await supabase
        .from('fee_payments')
        .select('student_fee_id, amount, is_refund')
        .in('student_fee_id', gradSfIds)
        .is('voided_at', null)
    : { data: [] as any[] };

  const paidBySf = new Map<string, number>();
  for (const p of gradPays ?? []) {
    const sign = (p as any).is_refund ? -1 : 1; // refunds subtract (audit H-2)
    paidBySf.set((p as any).student_fee_id, (paidBySf.get((p as any).student_fee_id) ?? 0) + sign * Number((p as any).amount));
  }
  const sfsByStudent = new Map<string, any[]>();
  for (const sf of gradSfs ?? []) {
    const arr = sfsByStudent.get((sf as any).student_id) ?? [];
    arr.push(sf);
    sfsByStudent.set((sf as any).student_id, arr);
  }

  const graduated: ArchiveListItem[] = (gradRows ?? []).map((g: any) => {
    const sfs = sfsByStudent.get(g.id) ?? [];
    let totalDue = 0, totalPaid = 0;
    let currency = 'USD';
    for (const sf of sfs) {
      totalDue += Number(sf.total_amount) + Number(sf.adjustment);
      totalPaid += paidBySf.get(sf.id) ?? 0;
      currency = sf.fee_plans?.currency ?? currency;
    }
    return {
      kind: 'graduated',
      id: g.id,
      fullName: g.full_name,
      className: g.classes?.name ?? null,
      parentName: g.parents?.full_name ?? null,
      parentPhone: g.parents?.phone_number ?? null,
      date: null,
      reason: null,
      totalDue,
      totalPaid,
      balance: Math.max(0, totalDue - totalPaid),
      currency,
    };
  });

  let combined = [...archived, ...graduated];
  if (search) {
    combined = combined.filter(r =>
      r.fullName.toLowerCase().includes(search)
      || (r.parentName ?? '').toLowerCase().includes(search)
      || (r.className ?? '').toLowerCase().includes(search),
    );
  }

  // Row-list pagination over the already-built, search-filtered set. This
  // is an in-memory merge of two bounded sources (archived + graduated),
  // so we slice rather than keyset. Cursor = opaque base64 of the unique
  // `${kind}:${id}` key; an unknown cursor restarts from the top (safe).
  const ARCHIVE_PAGE = 50;
  const keyOf = (r: ArchiveListItem) => `${r.kind}:${r.id}`;
  const rawCursor = req.query.cursor;
  let startIdx = 0;
  if (typeof rawCursor === 'string' && rawCursor) {
    let want = '';
    try { want = Buffer.from(rawCursor, 'base64url').toString('utf8'); } catch { want = ''; }
    if (want) {
      const at = combined.findIndex(r => keyOf(r) === want);
      if (at >= 0) startIdx = at + 1;
    }
  }
  const pageRows = combined.slice(startIdx, startIdx + ARCHIVE_PAGE);
  const hasMore = startIdx + ARCHIVE_PAGE < combined.length;
  const nextCursor = hasMore && pageRows.length > 0
    ? Buffer.from(keyOf(pageRows[pageRows.length - 1]), 'utf8').toString('base64url')
    : null;
  res.json({ data: pageRows, limit: ARCHIVE_PAGE, nextCursor });
}

async function loadArchiveDetail(schoolId: string, kind: 'archived' | 'graduated', id: string): Promise<ArchivePaymentExportData | null> {
  const { data: schoolRow } = await supabase
    .from('schools').select('name, logo_url').eq('id', schoolId).single();
  const schoolName = (schoolRow as any)?.name ?? 'School';
  const schoolLogoUrl = (schoolRow as any)?.logo_url ?? null;

  if (kind === 'archived') {
    const { data: row } = await supabase
      .from('archived_students')
      .select('id, full_name, departure_date, reason, parent_full_name, parent_phone, enrollment_history, classes_attended, payment_history')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();
    if (!row) return null;
    const history = Array.isArray((row as any).enrollment_history) ? (row as any).enrollment_history : [];
    const legacy = Array.isArray((row as any).classes_attended) ? (row as any).classes_attended : [];
    const lastClass = history.length
      ? (history[history.length - 1]?.className ?? history[history.length - 1]?.gradeLevel ?? null)
      : (legacy.length ? (legacy[legacy.length - 1]?.className ?? null) : null);
    return {
      schoolName,
      schoolLogoUrl,
      studentName: (row as any).full_name,
      status: 'archived',
      parentName: (row as any).parent_full_name ?? null,
      parentPhone: (row as any).parent_phone ?? null,
      className: lastClass,
      departureDate: (row as any).departure_date ?? null,
      reason: (row as any).reason ?? null,
      plans: plansFromSnapshot((row as any).payment_history),
    };
  }

  // graduated
  const { data: row } = await supabase
    .from('students')
    .select('id, full_name, is_graduated, classes(name), parents(full_name, phone_number)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();
  if (!row || !(row as any).is_graduated) return null;
  return {
    schoolName,
    schoolLogoUrl,
    studentName: (row as any).full_name,
    status: 'graduated',
    parentName: (row as any).parents?.full_name ?? null,
    parentPhone: (row as any).parents?.phone_number ?? null,
    className: (row as any).classes?.name ?? null,
    departureDate: null,
    reason: null,
    plans: await plansFromGraduated(schoolId, id),
  };
}

export async function getArchivePaymentRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const kind = req.params.kind as 'archived' | 'graduated';
  if (kind !== 'archived' && kind !== 'graduated') { res.status(400).json({ error: 'kind must be archived or graduated' }); return; }
  const detail = await loadArchiveDetail(schoolId, kind, req.params.id as string);
  if (!detail) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(detail);
}

function safeFile(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'student';
}

export async function archivePaymentPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const kind = req.params.kind as 'archived' | 'graduated';
  if (kind !== 'archived' && kind !== 'graduated') { res.status(400).json({ error: 'kind must be archived or graduated' }); return; }
  const detail = await loadArchiveDetail(schoolId, kind, req.params.id as string);
  if (!detail) { res.status(404).json({ error: 'Not found' }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${safeFile(detail.studentName)}.pdf"`);
  await streamArchivePaymentPdf(res, detail);
}

export async function archivePaymentXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const kind = req.params.kind as 'archived' | 'graduated';
  if (kind !== 'archived' && kind !== 'graduated') { res.status(400).json({ error: 'kind must be archived or graduated' }); return; }
  const detail = await loadArchiveDetail(schoolId, kind, req.params.id as string);
  if (!detail) { res.status(404).json({ error: 'Not found' }); return; }

  const buf = buildArchivePaymentXlsx(detail);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${safeFile(detail.studentName)}.xlsx"`);
  res.send(buf);
}
