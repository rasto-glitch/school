import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Calendar, Clock } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { CardListSkeleton } from '../../components/common/Skeleton';
import type { Student, Appointment } from '../../types';
import { format, parseISO } from 'date-fns';

const statusColors: Record<string, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow', approved: 'green', rejected: 'red',
};

export default function AppointmentsPage() {
  const { t } = useTranslation();
  const [children, setChildren] = useState<Student[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [selectedChildren, setSelectedChildren] = useState<string[]>([]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ reason: string; message: string; requestedDate: string }>();

  useEffect(() => {
    setError(false);
    Promise.all([parentApi.getChildren(), parentApi.getAppointments()])
      .then(([c, a]) => {
        setChildren(c.data || []);
        setAppointments(a.data || []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [retryKey]);

  const toggleChild = (id: string) => {
    setSelectedChildren(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const onSubmit = async (data: any) => {
    setSubmitting(true);
    try {
      await parentApi.createAppointment({ ...data, studentIds: selectedChildren });
      toast.success(t('appointments.toast_success'));
      reset();
      setSelectedChildren([]);
      parentApi.getAppointments().then(r => setAppointments(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('appointments.toast_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageLayout title={t('appointments.title')} subtitle={t('appointments.subtitle')}>
      <div className="space-y-6 max-w-2xl">
        {/* Request form */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('appointments.new_request')}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {children.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">{t('appointments.select_students')}</p>
                <div className="flex flex-wrap gap-2">
                  {children.map(c => (
                    <label key={c.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer border-2 transition-colors ${selectedChildren.includes(c.id) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="checkbox" className="hidden" checked={selectedChildren.includes(c.id)} onChange={() => toggleChild(c.id)} />
                      <span className="text-sm font-medium">{c.fullName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Input label={t('appointments.reason')} placeholder={t('appointments.reason_placeholder')} error={errors.reason?.message} {...register('reason', { required: 'Reason is required' })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('appointments.message')}</label>
              <textarea className="input-field min-h-[100px] resize-none" placeholder={t('appointments.message_placeholder')} {...register('message')} />
            </div>
            <Input label={t('appointments.preferred_date')} type="date" {...register('requestedDate')} />
            <Button type="submit" loading={submitting} fullWidth icon={<Calendar className="w-4 h-4" />}>
              {t('appointments.submit')}
            </Button>
          </form>
        </Card>

        {/* Previous appointments */}
        {loading ? <CardListSkeleton count={2} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : appointments.length === 0 ? (
          <EmptyState title={t('appointments.no_appointments')} icon={<Calendar className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">{t('appointments.my_requests')}</h2>
            <div className="space-y-3">
              {appointments.map(apt => (
                <Card key={apt.id}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{apt.reason}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('appointments.requested')}: {apt.requestedDate ? format(parseISO(apt.requestedDate), 'MMM d, yyyy') : t('appointments.no_date')}
                      </p>
                    </div>
                    <Badge color={statusColors[apt.status] || 'gray'}>
                      {apt.status === 'pending' ? t('appointments.status_pending')
                        : apt.status === 'approved' ? t('appointments.status_approved')
                        : apt.status === 'rejected' ? t('appointments.status_rejected')
                        : apt.status}
                    </Badge>
                  </div>
                  {apt.responseMessage && (
                    <div className="bg-gray-50 rounded-xl p-3 mt-2">
                      <p className="text-xs font-semibold text-gray-500 mb-1">{t('appointments.school_response')}</p>
                      <p className="text-sm text-gray-700">{apt.responseMessage}</p>
                      {apt.scheduledDate && (
                        <p className="text-xs text-primary-600 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {t('appointments.scheduled')}: {format(parseISO(apt.scheduledDate), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
