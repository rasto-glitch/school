import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Calendar, CheckCircle, XCircle } from 'lucide-react';
import { receptionApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Appointment } from '../../types';
import { format, parseISO } from 'date-fns';

const statusColors: Record<string, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
};

export default function ReceptionAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);

  const load = () => {
    receptionApi.getAppointments().then(r => setAppointments(r.data || [])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const respond = async (id: string, status: 'approved' | 'rejected') => {
    setResponding(id);
    try {
      const responseMessage = (document.getElementById(`msg-${id}`) as HTMLTextAreaElement)?.value || '';
      const scheduledDate = (document.getElementById(`date-${id}`) as HTMLInputElement)?.value || '';
      await receptionApi.respondToAppointment(id, { responseMessage, scheduledDate, status });
      toast.success(`Appointment ${status}!`);
      load();
    } catch {
      toast.error('Failed to respond');
    } finally {
      setResponding(null);
    }
  };

  return (
    <PageLayout title="Appointments" subtitle="Respond to parent appointment requests">
      {loading ? <LoadingSpinner /> : appointments.length === 0 ? (
        <EmptyState title="No appointments" icon={<Calendar className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-4">
          {appointments.map(apt => (
            <Card key={apt.id}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{(apt as any).parents?.full_name || 'Parent'}</h3>
                    <Badge color={statusColors[apt.status] || 'gray'}>{apt.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">Reason: {apt.reason}</p>
                  {apt.message && <p className="text-sm text-gray-600 mt-1 bg-gray-50 rounded-lg p-2">{apt.message}</p>}
                  <p className="text-xs text-gray-400 mt-1">Submitted: {format(parseISO(apt.createdAt), 'MMM d, yyyy')}</p>
                </div>
              </div>

              {apt.status === 'pending' && (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <textarea
                    id={`msg-${apt.id}`}
                    className="input-field min-h-[80px] resize-none text-sm"
                    placeholder="Response message..."
                    defaultValue={apt.responseMessage || ''}
                  />
                  <Input id={`date-${apt.id}`} type="date" label="Schedule Date" defaultValue={apt.scheduledDate || ''} />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      icon={<CheckCircle className="w-4 h-4" />}
                      loading={responding === apt.id}
                      onClick={() => respond(apt.id, 'approved')}
                    >Approve</Button>
                    <Button
                      variant="danger"
                      icon={<XCircle className="w-4 h-4" />}
                      loading={responding === apt.id}
                      onClick={() => respond(apt.id, 'rejected')}
                    >Reject</Button>
                  </div>
                </div>
              )}

              {apt.responseMessage && apt.status !== 'pending' && (
                <div className="border-t border-gray-100 pt-2 mt-2">
                  <p className="text-xs text-gray-500">Response: {apt.responseMessage}</p>
                  {apt.scheduledDate && <p className="text-xs text-gray-500">Scheduled: {apt.scheduledDate}</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
