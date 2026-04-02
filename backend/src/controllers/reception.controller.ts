import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify } from '../utils/notify';

export async function getPendingAppointmentCount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { count, error } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ count: count ?? 0 });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
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

  const { data, error } = await supabase.from('appointments')
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
