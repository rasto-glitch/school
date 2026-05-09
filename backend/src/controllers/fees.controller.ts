import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { streamPaymentReceipt, streamYearSummary } from '../utils/receipts';
import { streamArchivePaymentPdf, buildArchivePaymentXlsx, type ArchivePaymentExportData, type ArchivePlanEntry } from '../utils/paymentArchiveExport';
import { logAudit } from '../utils/audit';

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
    .select('id, name, total_amount, currency, applies_to, academic_year, is_active, created_at')
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }

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
    createdAt: p.created_at,
    installments: installmentsByPlan.get(p.id) ?? [],
    classIds: classesByPlan.get(p.id) ?? [],
  })));
}

interface PlanWriteBody {
  name: string;
  totalAmount: number;
  currency?: string;
  appliesTo: ApplyTo;
  classIds?: string[];
  academicYear?: string;
  installments: { sequence: number; amount: number; dueDate: string }[];
  isActive?: boolean;
}

function validatePlanBody(body: any): string | null {
  if (!body?.name || typeof body.name !== 'string') return 'name is required';
  if (typeof body.totalAmount !== 'number' || body.totalAmount < 0) return 'totalAmount must be a non-negative number';
  if (!['all', 'classes', 'manual'].includes(body.appliesTo)) return 'appliesTo must be all|classes|manual';
  if (!Array.isArray(body.installments) || body.installments.length === 0) return 'installments must be a non-empty array';
  const sumI = body.installments.reduce((s: number, i: any) => s + Number(i.amount), 0);
  if (Math.abs(sumI - body.totalAmount) > 0.01) return 'installments must sum to totalAmount';
  if (body.appliesTo === 'classes' && (!Array.isArray(body.classIds) || body.classIds.length === 0)) {
    return 'classIds must be a non-empty array when appliesTo=classes';
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
  }).select().single();
  if (pErr || !plan) { res.status(500).json({ error: pErr?.message ?? 'Failed to create plan' }); return; }

  if (body.installments.length) {
    const rows = body.installments.map(i => ({
      school_id: schoolId,
      fee_plan_id: plan.id,
      sequence: i.sequence,
      amount: i.amount,
      due_date: i.dueDate,
    }));
    const { error: iErr } = await supabase.from('fee_installments').insert(rows);
    if (iErr) { await supabase.from('fee_plans').delete().eq('id', plan.id); res.status(500).json({ error: iErr.message }); return; }
  }
  if (body.appliesTo === 'classes' && body.classIds?.length) {
    const cRows = body.classIds.map(id => ({ fee_plan_id: plan.id, class_id: id }));
    const { error: cErr } = await supabase.from('fee_plan_classes').insert(cRows);
    if (cErr) { await supabase.from('fee_plans').delete().eq('id', plan.id); res.status(500).json({ error: cErr.message }); return; }
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
  }).eq('id', id).eq('school_id', schoolId);
  if (pErr) { res.status(500).json({ error: pErr.message }); return; }

  const { data: after } = await supabase.from('fee_plans').select('*').eq('id', id).eq('school_id', schoolId).single();
  await logAudit({ req, entityType: 'fee_plan', entityId: String(id), action: 'update', before: before || undefined, after: after || undefined, label: (after as { name?: string } | null)?.name ?? body.name });

  // Replace installments + class targets atomically (best effort — no transaction support via PostgREST)
  await supabase.from('fee_installments').delete().eq('fee_plan_id', id).eq('school_id', schoolId);
  if (body.installments.length) {
    await supabase.from('fee_installments').insert(body.installments.map(i => ({
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'fee_plan', entityId: String(id), action: 'update', before, after, label: (before as { name?: string }).name });
  res.json({ success: true });
}

export async function listVoidedPlans(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('fee_plans')
    .select('id, name, total_amount, currency, applies_to, academic_year, is_active, created_at, voided_at, voided_by, void_reason')
    .eq('school_id', schoolId)
    .not('voided_at', 'is', null)
    .order('voided_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }

  const voiderIds = Array.from(new Set((data ?? []).map((p: any) => p.voided_by).filter(Boolean)));
  const { data: users } = voiderIds.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', voiderIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }
  res.json((data ?? []).map((p: any) => ({
    ...(toCC(p) as Record<string, unknown>),
    voidedByName: p.voided_by ? nameByUser.get(p.voided_by) ?? null : null,
  })));
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
    .from('fee_plans').select('id, total_amount, applies_to').eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
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
  if (error) { res.status(500).json({ error: error.message }); return; }
  for (const row of (inserted || [])) {
    await logAudit({ req, entityType: 'student_fee', entityId: (row as { id: string }).id, action: 'create', after: row as Record<string, unknown>, reason: 'Plan assigned' });
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
  paid: number;
  balance: number;
  status: Status;
  installments: { id: string; sequence: number; amount: number; effectiveAmount: number; dueDate: string }[];
  lockedFeatures: string[];
}

async function buildStudentFeeRows(schoolId: string): Promise<StudentFeeRow[]> {
  const cfg = await getTuitionConfig(schoolId);
  const today = new Date().toISOString().split('T')[0];

  const { data: sfs, error } = await supabase
    .from('student_fees')
    .select(`
      id, student_id, total_amount, adjustment, fee_plan_id,
      students!inner(id, full_name, parent_id, classes(name), parents(id, full_name, user_id)),
      fee_plans!inner(id, name, currency, academic_year)
    `)
    .eq('school_id', schoolId);
  if (error || !sfs) return [];

  const planIds = Array.from(new Set(sfs.map(s => (s as any).fee_plan_id)));
  const studentIds = Array.from(new Set(sfs.map(s => (s as any).student_id)));
  const sfIds = sfs.map(s => (s as any).id);

  const [{ data: insts }, { data: pays }, { data: locks }] = await Promise.all([
    supabase.from('fee_installments').select('fee_plan_id, id, sequence, amount, due_date').in('fee_plan_id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('fee_payments').select('student_fee_id, amount').in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000']).is('voided_at', null),
    supabase.from('student_access_locks').select('student_id, feature').in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']),
  ]);

  const instByPlan = new Map<string, { id: string; sequence: number; amount: number; dueDate: string; due_date: string }[]>();
  for (const i of insts ?? []) {
    const arr = instByPlan.get((i as any).fee_plan_id) ?? [];
    arr.push({ id: (i as any).id, sequence: (i as any).sequence, amount: Number((i as any).amount), dueDate: (i as any).due_date, due_date: (i as any).due_date });
    instByPlan.set((i as any).fee_plan_id, arr);
  }
  const paidBySf = new Map<string, number>();
  for (const p of pays ?? []) {
    paidBySf.set((p as any).student_fee_id, (paidBySf.get((p as any).student_fee_id) ?? 0) + Number((p as any).amount));
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
    const dueTotal = totalAmount + adjustment - siblingDiscount;
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
      totalAmount,
      adjustment,
      siblingDiscount,
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
    totalDue: g.students.reduce((s, r) => s + (r.totalAmount + r.adjustment - r.siblingDiscount), 0),
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
    .select('id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at')
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
      };
    }),
  });
}

// ── Payments (admin only) ───────────────────────────────────────────────

export async function recordPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // student_fee_id
  const { amount, paidOn, method, reference, notes, unallocatedNote } = req.body;
  const rawAllocations = req.body.allocations;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!paidOn) { res.status(400).json({ error: 'paidOn is required' }); return; }

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

  // Verify student_fee exists in this school
  const { data: sf } = await supabase
    .from('student_fees')
    .select('id, fee_plan_id, students(full_name, parents(user_id))')
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

  const { data, error } = await supabase.from('fee_payments').insert({
    school_id: schoolId,
    student_fee_id: id,
    amount,
    paid_on: paidOn,
    method: method ?? null,
    reference: reference ?? null,
    notes: notes ?? null,
    unallocated_note: storedUnallocatedNote,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }

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
      res.status(500).json({ error: aErr.message }); return;
    }
  }

  const studentName = (sf as { students?: { full_name?: string } }).students?.full_name;
  await logAudit({ req, entityType: 'fee_payment', entityId: data.id, action: 'create', after: { ...data, allocations }, label: studentName });

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
  const { data: after, error } = await supabase
    .from('fee_payments')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  const studentName = (before as { student_fees?: { students?: { full_name?: string } } }).student_fees?.students?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.student_fees;
  await logAudit({ req, entityType: 'fee_payment', entityId: String(id), action: 'update', before: beforeRow, after, label: studentName, reason: reason ?? undefined });
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
  const { data: after, error } = await supabase
    .from('fee_payments')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  const studentName = (before as { student_fees?: { students?: { full_name?: string } } }).student_fees?.students?.full_name;
  const beforeRow: Record<string, unknown> = { ...(before as Record<string, unknown>) };
  delete beforeRow.student_fees;
  await logAudit({ req, entityType: 'fee_payment', entityId: String(id), action: 'update', before: beforeRow, after, label: studentName });
  res.json({ success: true });
}

export async function listVoidedPayments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { data, error } = await supabase
    .from('fee_payments')
    .select('id, amount, paid_on, method, reference, notes, voided_at, voided_by, void_reason, student_fee_id, student_fees(students(id, full_name), fee_plans(name, currency))')
    .eq('school_id', schoolId)
    .not('voided_at', 'is', null)
    .order('voided_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }

  const voiderIds = Array.from(new Set((data ?? []).map((p: any) => p.voided_by).filter(Boolean)));
  const { data: users } = voiderIds.length
    ? await supabase.from('users').select('id, first_name, last_name').in('id', voiderIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string>();
  for (const u of (users ?? []) as any[]) {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    if (name) nameByUser.set(u.id, name);
  }
  res.json((data ?? []).map((p: any) => ({
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
  })));
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
  if (error) { res.status(500).json({ error: error.message }); return; }

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

  const [classesRes, schoolRes] = await Promise.all([
    supabase.from('classes').select('id, name, grade_level').eq('school_id', schoolId).order('name'),
    supabase.from('schools').select('current_academic_year').eq('id', schoolId).single(),
  ]);

  if (classesRes.error) { res.status(500).json({ error: classesRes.error.message }); return; }

  res.json({
    classes: toCC(classesRes.data || []),
    currentAcademicYear: schoolRes.data?.current_academic_year ?? null,
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

export async function removeLock(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { studentId, feature } = req.params;
  const { error } = await supabase
    .from('student_access_locks').delete()
    .eq('school_id', schoolId).eq('student_id', studentId).eq('feature', feature);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

// ── Receipts ────────────────────────────────────────────────────────────

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
// admin/accountant/reception: their school. parent: must own the student.
async function authorizeReceipt(req: AuthRequest, studentFeeId: string): Promise<{ ok: boolean }> {
  const { schoolId, userId, role } = req.user!;
  const { data: sf } = await supabase
    .from('student_fees')
    .select('school_id, students!inner(parents(user_id))')
    .eq('id', studentFeeId).single();
  if (!sf || (sf as any).school_id !== schoolId) return { ok: false };
  if (role === 'admin' || role === 'accountant' || role === 'reception') return { ok: true };
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

  const { id } = req.params; // payment id

  const { data: payment } = await supabase
    .from('fee_payments').select('id, student_fee_id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null).single();
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }

  const auth = await authorizeReceipt(req, (payment as any).student_fee_id);
  if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ctx = await loadReceiptContext(schoolId, (payment as any).student_fee_id);
  if (!ctx) { res.status(404).json({ error: 'Not found' }); return; }

  // Sum of payments BEFORE this one
  const { data: priorRows } = await supabase
    .from('fee_payments').select('amount, created_at')
    .eq('student_fee_id', (payment as any).student_fee_id)
    .is('voided_at', null)
    .lt('created_at', (payment as any).created_at ?? new Date().toISOString());
  const paidBefore = (priorRows ?? []).reduce((s, p) => s + Number((p as any).amount), 0);

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
  res.setHeader('Content-Disposition', `inline; filename="receipt-${(payment as any).id.slice(0, 8)}.pdf"`);
  await streamPaymentReceipt(res, {
    school: ctx.schoolInfo,
    parentName: ctx.parentName,
    studentName: ctx.studentName,
    planName: ctx.planName,
    academicYear: ctx.academicYear,
    currency: ctx.currency,
    receiptNumber: `FEE-${(payment as any).id.slice(0, 8).toUpperCase()}`,
    paidOn: (payment as any).paid_on,
    amount: paymentAmount,
    method: (payment as any).method,
    reference: (payment as any).reference,
    notes: (payment as any).notes,
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
  const auth = await authorizeReceipt(req, id);
  if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ctx = await loadReceiptContext(schoolId, id);
  if (!ctx) { res.status(404).json({ error: 'Not found' }); return; }

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

  // Attach payments per student_fee
  const sfIds = mine.map(r => r.id);
  const { data: payments } = await supabase
    .from('fee_payments')
    .select('id, student_fee_id, amount, paid_on, method, reference, notes, unallocated_note, recorded_by, created_at')
    .in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000'])
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
        .select('student_fee_id, amount, paid_on, method, reference, notes')
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
    totalPaid += p.payments.reduce((s, x) => s + x.amount, 0);
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
    .select('id, full_name, departure_date, reason, parent_full_name, parent_phone, classes_attended, payment_history, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  const archived: ArchiveListItem[] = (archivedRows ?? []).map((r: any) => {
    const plans = plansFromSnapshot(r.payment_history);
    const sum = summarisePlans(plans);
    const lastClass = Array.isArray(r.classes_attended) && r.classes_attended.length
      ? r.classes_attended[r.classes_attended.length - 1].className ?? null
      : null;
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
        .select('student_fee_id, amount')
        .in('student_fee_id', gradSfIds)
        .is('voided_at', null)
    : { data: [] as any[] };

  const paidBySf = new Map<string, number>();
  for (const p of gradPays ?? []) {
    paidBySf.set((p as any).student_fee_id, (paidBySf.get((p as any).student_fee_id) ?? 0) + Number((p as any).amount));
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
  res.json(combined);
}

async function loadArchiveDetail(schoolId: string, kind: 'archived' | 'graduated', id: string): Promise<ArchivePaymentExportData | null> {
  const { data: schoolRow } = await supabase
    .from('schools').select('name, logo_url').eq('id', schoolId).single();
  const schoolName = (schoolRow as any)?.name ?? 'School';
  const schoolLogoUrl = (schoolRow as any)?.logo_url ?? null;

  if (kind === 'archived') {
    const { data: row } = await supabase
      .from('archived_students')
      .select('id, full_name, departure_date, reason, parent_full_name, parent_phone, classes_attended, payment_history')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();
    if (!row) return null;
    const lastClass = Array.isArray((row as any).classes_attended) && (row as any).classes_attended.length
      ? (row as any).classes_attended[(row as any).classes_attended.length - 1].className ?? null
      : null;
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
