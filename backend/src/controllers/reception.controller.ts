import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify } from '../utils/notify';

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
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ count: count ?? 0 });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('appointments')
    .select('*, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function respondToAppointment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { responseMessage, scheduledDate, status } = req.body;

  const { data, error } = await req.db!.from('appointments')
    .update({ response_message: responseMessage, scheduled_date: scheduledDate || null, status })
    .eq('id', id).eq('school_id', schoolId)
    .select('*, parents(user_id)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

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

  res.json(toCC(data));
}
