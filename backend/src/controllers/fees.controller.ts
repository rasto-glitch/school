import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { streamPaymentReceipt, streamYearSummary } from '../utils/receipts';

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

  const { error: pErr } = await supabase.from('fee_plans').update({
    name: body.name,
    total_amount: body.totalAmount,
    currency: body.currency,
    applies_to: body.appliesTo,
    academic_year: body.academicYear ?? null,
    is_active: body.isActive ?? true,
  }).eq('id', id).eq('school_id', schoolId);
  if (pErr) { res.status(500).json({ error: pErr.message }); return; }

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
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  // Block delete if any payment has been recorded against any student_fee under this plan.
  const { data: sfs } = await supabase.from('student_fees').select('id').eq('school_id', schoolId).eq('fee_plan_id', id);
  if (sfs && sfs.length) {
    const sfIds = sfs.map(s => (s as any).id);
    const { count } = await supabase.from('fee_payments').select('id', { count: 'exact', head: true }).in('student_fee_id', sfIds);
    if ((count ?? 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a plan with recorded payments. Mark it inactive instead.' });
      return;
    }
  }
  const { error } = await supabase.from('fee_plans').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
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
    .from('fee_plans').select('id, total_amount, applies_to').eq('id', id).eq('school_id', schoolId).single();
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
  const { error } = await supabase.from('student_fees').insert(rows);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ assigned: toInsert.length, skipped: studentIds.length - toInsert.length });
}

// ── Students/families list (admin + reception read; admin-only writes) ──

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
  installments: { id: string; sequence: number; amount: number; dueDate: string }[];
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
    supabase.from('fee_payments').select('student_fee_id, amount').in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000']),
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
      installments: installments.map(i => ({ id: i.id, sequence: i.sequence, amount: i.amount, dueDate: i.dueDate })),
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
    .select('id, amount, paid_on, method, reference, notes, recorded_by, created_at')
    .eq('student_fee_id', id)
    .eq('school_id', schoolId)
    .order('paid_on', { ascending: false });

  res.json({
    ...row,
    payments: (payments ?? []).map(p => ({
      id: (p as any).id,
      amount: Number((p as any).amount),
      paidOn: (p as any).paid_on,
      method: (p as any).method,
      reference: (p as any).reference,
      notes: (p as any).notes,
      recordedBy: (p as any).recorded_by,
      createdAt: (p as any).created_at,
    })),
  });
}

// ── Payments (admin only) ───────────────────────────────────────────────

export async function recordPayment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params; // student_fee_id
  const { amount, paidOn, method, reference, notes } = req.body;

  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (!paidOn) { res.status(400).json({ error: 'paidOn is required' }); return; }

  // Verify student_fee exists in this school
  const { data: sf } = await supabase
    .from('student_fees')
    .select('id, students(parents(user_id))')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!sf) { res.status(404).json({ error: 'Student fee not found' }); return; }

  const { data, error } = await supabase.from('fee_payments').insert({
    school_id: schoolId,
    student_fee_id: id,
    amount,
    paid_on: paidOn,
    method: method ?? null,
    reference: reference ?? null,
    notes: notes ?? null,
    recorded_by: userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }

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
  const { schoolId } = req.user!;
  const guard = await ensurePremium(schoolId);
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return; }

  const { id } = req.params;
  const { error } = await supabase.from('fee_payments').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
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

  const { error } = await supabase.from('student_fees').update(upd).eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
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
// admin/reception: their school. parent: must own the student.
async function authorizeReceipt(req: AuthRequest, studentFeeId: string): Promise<{ ok: boolean }> {
  const { schoolId, userId, role } = req.user!;
  const { data: sf } = await supabase
    .from('student_fees')
    .select('school_id, students!inner(parents(user_id))')
    .eq('id', studentFeeId).single();
  if (!sf || (sf as any).school_id !== schoolId) return { ok: false };
  if (role === 'admin' || role === 'reception') return { ok: true };
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
    .from('fee_payments').select('id, student_fee_id, amount, paid_on, method, reference, notes, created_at')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }

  const auth = await authorizeReceipt(req, (payment as any).student_fee_id);
  if (!auth.ok) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ctx = await loadReceiptContext(schoolId, (payment as any).student_fee_id);
  if (!ctx) { res.status(404).json({ error: 'Not found' }); return; }

  // Sum of payments BEFORE this one
  const { data: priorRows } = await supabase
    .from('fee_payments').select('amount, created_at')
    .eq('student_fee_id', (payment as any).student_fee_id)
    .lt('created_at', (payment as any).created_at ?? new Date().toISOString());
  const paidBefore = (priorRows ?? []).reduce((s, p) => s + Number((p as any).amount), 0);

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
    amount: Number((payment as any).amount),
    method: (payment as any).method,
    reference: (payment as any).reference,
    notes: (payment as any).notes,
    totalAmount: ctx.totalAmount,
    adjustment: ctx.adjustment,
    siblingDiscount: ctx.siblingDiscount,
    paidBefore,
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
    .select('id, amount, paid_on, method, reference')
    .eq('student_fee_id', id)
    .eq('school_id', schoolId)
    .order('paid_on', { ascending: true });

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
    payments: (payments ?? []).map(p => ({
      id: (p as any).id,
      paidOn: (p as any).paid_on,
      amount: Number((p as any).amount),
      method: (p as any).method,
      reference: (p as any).reference,
    })),
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
    .select('id, student_fee_id, amount, paid_on, method, reference, notes, created_at')
    .in('student_fee_id', sfIds.length ? sfIds : ['00000000-0000-0000-0000-000000000000'])
    .order('paid_on', { ascending: false });

  const paysBySf = new Map<string, any[]>();
  for (const p of payments ?? []) {
    const arr = paysBySf.get((p as any).student_fee_id) ?? [];
    arr.push({
      id: (p as any).id,
      amount: Number((p as any).amount),
      paidOn: (p as any).paid_on,
      method: (p as any).method,
      reference: (p as any).reference,
      notes: (p as any).notes,
      createdAt: (p as any).created_at,
    });
    paysBySf.set((p as any).student_fee_id, arr);
  }

  res.json(mine.map(r => ({ ...r, payments: paysBySf.get(r.id) ?? [] })));
}
