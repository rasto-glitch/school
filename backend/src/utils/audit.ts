// Audit writes are server-side, tamper-protected (hash-chained at the DB
// level) and called from many surfaces including non-request contexts.
// Elevated client by design.
import { adminDb as supabase } from './db';
import type { AuthRequest } from '../middleware/auth';

export type AuditAction = 'create' | 'update' | 'delete' | 'read' | 'export';
export type AuditEntityType =
  | 'student'
  | 'fee_plan'
  | 'student_fee'
  | 'fee_payment'
  | 'staff_member'
  | 'staff_salary_payment'
  | 'expense_category'
  | 'expense_template'
  | 'expense'
  | 'accounting_period'
  | 'payment_account'
  | 'fx_rate'
  | 'late_fee'
  | 'teacher'
  | 'driver'
  | 'supervisor'
  | 'admin'
  | 'reception'
  | 'accountant'
  // Wave 1 — employee legal-compliance records (migration 028)
  | 'employee_document'
  | 'employee_profile'
  // Wave 2 — extended PII + acknowledgements + actions (migration 029)
  | 'employee_extended_profile'
  | 'employee_emergency_contact'
  | 'school_policy'
  | 'employee_acknowledgement'
  | 'employee_action'
  | 'hr_officer'
  | 'archived_employee'
  | 'archived_student'
  // Class-level admin actions (e.g. year-end promote wizard, migration 030)
  | 'class'
  // Cross-school student transfer (migration 032, phase A)
  | 'student_transfer'
  // Supervisor overrides on locked-day attendance (Phase A daily lock)
  | 'attendance'
  // Self-service auth — email change + account recovery (migration 037)
  | 'user_account'
  // MFA enrollment / confirm / disable / regen (migration 038)
  | 'user_mfa'
  // Trusted devices — Phase 3 (migration 039)
  | 'trusted_device'
  // Login + session lifecycle events (migration 040)
  | 'user_session'
  // Reports — handoff share-toggle audit (migration 041 + PR 2)
  | 'report'
  // HD-4 (migration 046) — chart-of-accounts CRUD + manual journal entries
  | 'chart_of_account'
  | 'journal_entry'
  // Phase A — admin capability/clearance grants (migration 058)
  | 'admin_clearance';

interface LogParams {
  req: AuthRequest;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  label?: string | null;
  reason?: string | null;
}

// Fields excluded from diffs — either auto-managed or sensitive.
// Sensitive entries (`password_hash` etc.) are stripped here so the audit
// log's `changes` JSONB never permanently retains a credential, even when
// the caller hands logAudit() a full `after: user` row from a bare
// `.select()`. This is the inner of two defenses; the outer is the
// SENSITIVE_KEYS strip in utils/transform.ts.
const EXCLUDED_FIELDS = new Set([
  'created_at', 'updated_at', 'id',
  'password_hash', 'password',
  'token_hash', 'reset_token_hash', 'refresh_token_hash',
]);

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildChanges(
  action: AuditAction,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (action === 'create') {
    if (!after) return {};
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(after)) {
      if (EXCLUDED_FIELDS.has(k)) continue;
      row[k] = v;
    }
    return { _row: row };
  }
  if (action === 'delete') {
    if (!before) return {};
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(before)) {
      if (EXCLUDED_FIELDS.has(k)) continue;
      row[k] = v;
    }
    return { _row: row };
  }
  // update — diff non-excluded fields
  const out: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (EXCLUDED_FIELDS.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    if (!eq(a, b)) out[k] = { old: a ?? null, new: b ?? null };
  }
  return out;
}

// Best-effort write — failures must never block the user-facing mutation.
// Logs to console so the operator notices but the request still succeeds.
export async function logAudit(p: LogParams): Promise<void> {
  try {
    const user = p.req.user;
    if (!user) return;
    const changes = buildChanges(p.action, p.before, p.after);
    if (p.action === 'update' && Object.keys(changes).length === 0) return;

    const { error } = await supabase.from('audit_logs').insert({
      school_id: user.schoolId,
      entity_type: p.entityType,
      entity_id: p.entityId,
      action: p.action,
      changes,
      actor_id: user.userId,
      actor_username: user.username,
      actor_role: user.role,
      label: p.label ?? null,
      reason: p.reason ?? null,
    });
    if (error) console.error('[audit] insert failed:', error.message);
  } catch (e) {
    console.error('[audit] logAudit threw:', (e as Error).message);
  }
}
