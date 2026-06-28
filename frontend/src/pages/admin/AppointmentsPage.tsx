import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, User } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Appointment } from '../../types';
import { format, parseISO } from 'date-fns';

// Phase D — admins are read-only on appointments: reception confirms + assigns
// the admin. This shows the meetings assigned to the viewer (Owners see all),
// with both the parent's reason and the supervisor's invite reason.

const statusColors: Record<string, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
};

export default function AppointmentsPage() {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getAppointments().then(r => setAppointments(r.data || [])).finally(() => setLoading(false));
  }, []);

  return (
    <PageLayout title={t('nav.appointments')} subtitle={t('admin.meetings.subtitle')}>
      {loading ? <LoadingSpinner /> : appointments.length === 0 ? (
        <EmptyState title={t('admin.meetings.none')} icon={<Calendar className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-4 max-w-3xl">
          {appointments.map(apt => {
            const parents = (apt as any).parents;
            const parentName = parents?.fullName || parents?.full_name || t('reception.parent_fallback');
            return (
              <Card key={apt.id}>
                <div className="flex items-start justify-between mb-1 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{parentName}</h3>
                    <Badge color={statusColors[apt.status] || 'gray'}>{t(`appointments.status_${apt.status}`, { defaultValue: apt.status })}</Badge>
                  </div>
                  {apt.scheduledDate && (
                    <span className="text-xs font-medium text-primary-600 flex items-center gap-1 flex-shrink-0">
                      <Clock className="w-3 h-3" />{format(parseISO(apt.scheduledDate), 'MMM d, yyyy')}
                    </span>
                  )}
                </div>
                {apt.reason && <p className="text-sm text-gray-700">{t('appointments.reason')}: {apt.reason}</p>}
                {apt.message && <p className="text-sm text-gray-600 mt-1 bg-gray-50 rounded-lg p-2">{apt.message}</p>}
                {apt.inviteReason && (
                  <p className="text-xs text-gray-500 mt-1">
                    {t('admin.meetings.invite_from', { name: apt.invitedByName || t('admin.meetings.a_supervisor') })}: {apt.inviteReason}
                  </p>
                )}
                {apt.assignedAdminName && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <User className="w-3 h-3" />{t('admin.meetings.assigned_to', { name: apt.assignedAdminName })}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
