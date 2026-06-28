import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Calendar, CheckCircle, XCircle } from 'lucide-react';
import { receptionApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Appointment } from '../../types';
import { format, parseISO } from 'date-fns';

// Phase D — reception is the sole confirmer. On approval it assigns the admin
// who'll take the meeting (and may set a different time). Supervisor-invited
// appointments show BOTH the supervisor's reason and the parent's.

const statusColors: Record<string, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
};

export default function ReceptionAppointmentsPage() {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [admins, setAdmins] = useState<{ id: string; fullName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({}); // per-row chosen admin

  const load = () => {
    receptionApi.getAppointments().then(r => setAppointments(r.data || [])).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    receptionApi.getAssignableAdmins().then(r => setAdmins(r.data || [])).catch(() => {});
  }, []);

  const respond = async (id: string, status: 'approved' | 'rejected') => {
    const assignedAdminId = assign[id] || '';
    if (status === 'approved' && !assignedAdminId) { toast.error(t('reception.assign_required')); return; }
    setResponding(id);
    try {
      const responseMessage = (document.getElementById(`msg-${id}`) as HTMLTextAreaElement)?.value || '';
      const scheduledDate = (document.getElementById(`date-${id}`) as HTMLInputElement)?.value || '';
      await receptionApi.respondToAppointment(id, {
        responseMessage,
        scheduledDate,
        status,
        assignedAdminId: status === 'approved' ? assignedAdminId : null,
      });
      toast.success(status === 'approved' ? t('reception.toast_approved') : t('reception.toast_rejected'));
      load();
    } catch {
      toast.error(t('reception.respond_failed'));
    } finally {
      setResponding(null);
    }
  };

  return (
    <PageLayout title={t('nav.appointments')} subtitle={t('reception.subtitle')}>
      {loading ? <LoadingSpinner /> : appointments.length === 0 ? (
        <EmptyState title={t('reception.no_appointments')} icon={<Calendar className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-4 max-w-3xl">
          {appointments.map(apt => {
            const parents = (apt as any).parents;
            const parentName = parents?.fullName || parents?.full_name || t('reception.parent_fallback');
            return (
              <Card key={apt.id}>
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{parentName}</h3>
                      <Badge color={statusColors[apt.status] || 'gray'}>{t(`appointments.status_${apt.status}`, { defaultValue: apt.status })}</Badge>
                    </div>
                    {apt.reason && <p className="text-sm text-gray-500 mt-0.5">{t('appointments.reason')}: {apt.reason}</p>}
                    {apt.message && <p className="text-sm text-gray-600 mt-1 bg-gray-50 rounded-lg p-2">{apt.message}</p>}
                    {apt.inviteReason && (
                      <p className="text-xs text-indigo-700 bg-indigo-50 rounded-lg p-2 mt-1">
                        {t('reception.invite_from', { name: apt.invitedByName || t('admin.meetings.a_supervisor') })}: {apt.inviteReason}
                      </p>
                    )}
                    {apt.requestedDate && (
                      <p className="text-xs text-gray-400 mt-1">{t('reception.parent_requested', { date: format(parseISO(apt.requestedDate), 'MMM d, yyyy') })}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{t('reception.submitted', { date: format(parseISO(apt.createdAt), 'MMM d, yyyy') })}</p>
                  </div>
                </div>

                {apt.status === 'pending' && (
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <Select
                      label={t('reception.assign_admin')}
                      options={admins.map(a => ({ value: a.id, label: a.fullName }))}
                      placeholder={t('reception.choose_admin')}
                      value={assign[apt.id] || ''}
                      onChange={e => setAssign(s => ({ ...s, [apt.id]: e.target.value }))}
                    />
                    <Input id={`date-${apt.id}`} type="date" label={t('reception.schedule_date')} defaultValue={apt.scheduledDate || apt.requestedDate || ''} />
                    <textarea
                      id={`msg-${apt.id}`}
                      className="input-field min-h-[70px] resize-none text-sm"
                      placeholder={t('reception.response_ph')}
                      defaultValue={apt.responseMessage || ''}
                    />
                    <div className="flex gap-2">
                      <Button variant="secondary" icon={<CheckCircle className="w-4 h-4" />} loading={responding === apt.id} onClick={() => respond(apt.id, 'approved')}>{t('reception.approve')}</Button>
                      <Button variant="danger" icon={<XCircle className="w-4 h-4" />} loading={responding === apt.id} onClick={() => respond(apt.id, 'rejected')}>{t('reception.reject')}</Button>
                    </div>
                  </div>
                )}

                {apt.status !== 'pending' && (apt.responseMessage || apt.scheduledDate || apt.assignedAdminName) && (
                  <div className="border-t border-gray-100 pt-2 mt-2 space-y-0.5">
                    {apt.responseMessage && <p className="text-xs text-gray-500">{t('reception.response_label')} {apt.responseMessage}</p>}
                    {apt.scheduledDate && <p className="text-xs text-gray-500">{t('appointments.scheduled')}: {apt.scheduledDate}</p>}
                    {apt.assignedAdminName && <p className="text-xs text-gray-500">{t('admin.meetings.assigned_to', { name: apt.assignedAdminName })}</p>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
