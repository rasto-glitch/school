import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, emitToUser } from '../utils/notify';

// Tenant queries go through `req.db` (the per-request, RLS-bound client
// attached by authenticate). Until Phase 4 enables RLS on each table this
// is functionally identical to the old service-role path; once enabled
// the database physically rejects cross-school reads/writes.
// The explicit `.eq('school_id', schoolId)` filters are kept as defense
// in depth — redundant under RLS but cheap and self-documenting.

export async function getPendingAppointmentCount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { count, error } = await req.db!
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ count: count ?? 0 });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('appointments')
    .select('*, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Attach supervisor (invited_by) + assigned-admin display names so reception
  // can see who invited and who'll take the meeting (Phase D).
  const rows = (data as Record<string, any>[]) ?? [];
  const userIds = [...new Set(rows.flatMap(r => [r.invited_by, r.assigned_admin_id]).filter(Boolean))] as string[];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await req.db!
      .from('users').select('id, first_name, last_name')
      .eq('school_id', schoolId).in('id', userIds);
    (users ?? []).forEach((u: any) => { nameMap[u.id] = `${u.first_name} ${u.last_name}`.trim(); });
  }
  const enriched = rows.map(r => ({
    ...r,
    invited_by_name: r.invited_by ? (nameMap[r.invited_by] ?? null) : null,
    assigned_admin_name: r.assigned_admin_id ? (nameMap[r.assigned_admin_id] ?? null) : null,
  }));
  res.json(toCC(enriched));
}

// Admins reception can assign a meeting to: owner or anyone holding
// students.manage (the appointment capability) — "curated per clearance".
export async function getAssignableAdmins(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('users')
    .select('id, first_name, last_name, is_owner, admin_capabilities')
    .eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true)
    .order('first_name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const admins = ((data as any[]) ?? [])
    .filter(u => u.is_owner || (Array.isArray(u.admin_capabilities) && u.admin_capabilities.includes('students.manage')))
    .map(u => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, fullName: `${u.first_name} ${u.last_name}`.trim() }));
  res.json(admins);
}

export async function respondToAppointment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { responseMessage, scheduledDate, status, assignedAdminId } = req.body;

  const update: Record<string, unknown> = {
    response_message: responseMessage,
    scheduled_date: scheduledDate || null,
    status,
  };
  // Reception assigns the admin who'll take the meeting when confirming.
  if (assignedAdminId !== undefined) update.assigned_admin_id = assignedAdminId || null;

  const { data, error } = await req.db!.from('appointments')
    .update(update)
    .eq('id', id).eq('school_id', schoolId)
    .select('*, parents(user_id, full_name)')
    .single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const parentUserId = (data as any)?.parents?.user_id;
  if (parentUserId) {
    const approved = status === 'approved';
    notify({
      schoolId,
      userId: parentUserId,
      title: approved ? 'Appointment Approved' : 'Appointment Update',
      message: approved
        ? `Your appointment has been approved${scheduledDate ? ` on ${scheduledDate}` : ''}.${responseMessage ? ' ' + responseMessage : ''}`
        : `Your appointment request has been ${status}.${responseMessage ? ' ' + responseMessage : ''}`,
      type: 'appointment',
    }).catch(() => {});
  }

  // Notify the assigned admin they have a meeting to take (Phase D).
  if (status === 'approved' && assignedAdminId) {
    const parentName = (data as any)?.parents?.full_name || 'a parent';
    notify({
      schoolId,
      userId: assignedAdminId,
      title: 'Meeting assigned to you',
      message: `You're assigned a meeting with ${parentName}${scheduledDate ? ` on ${scheduledDate}` : ''}.`,
      type: 'appointment',
      relatedId: String(id),
    }).catch(() => {});
  }

  // Push the new status to both chat participants so a linked in-chat invite
  // card flips live (invited → pending → approved/rejected). For appointments
  // with no chat invite message, no card matches the id, so it's a harmless
  // no-op on the clients.
  const appt = data as { id: string; status?: string; scheduled_date?: string | null; requested_date?: string | null; reason?: string | null; invite_reason?: string | null; invited_by?: string | null };
  const invitePayload = {
    appointmentId: appt.id,
    appointment: {
      id: appt.id,
      status: appt.status,
      scheduledDate: appt.scheduled_date,
      requestedDate: appt.requested_date,
      reason: appt.reason,
      inviteReason: appt.invite_reason,
    },
  };
  if (parentUserId) emitToUser(schoolId, parentUserId, 'chat:invite_update', invitePayload);
  if (appt.invited_by) emitToUser(schoolId, appt.invited_by, 'chat:invite_update', invitePayload);

  res.json(toCC(data));
}
