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
import Modal from '../../components/common/Modal';
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

  // ── Supervisor invite: complete (book) or decline ──
  const [invite, setInvite] = useState<Appointment | null>(null); // invite being completed
  const [icReason, setIcReason] = useState('');
  const [icMessage, setIcMessage] = useState('');
  const [icDate, setIcDate] = useState('');
  const [icSubmitting, setIcSubmitting] = useState(false);

  const openComplete = (apt: Appointment) => { setInvite(apt); setIcReason(''); setIcMessage(''); setIcDate(''); };

  const submitComplete = async () => {
    if (!invite) return;
    if (!icReason.trim()) { toast.error(t('appointments.reason_required')); return; }
    setIcSubmitting(true);
    try {
      await parentApi.completeInvite(invite.id, { reason: icReason.trim(), message: icMessage.trim() || undefined, requestedDate: icDate || undefined });
      toast.success(t('appointments.toast_success'));
      setInvite(null);
      parentApi.getAppointments().then(r => setAppointments(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('appointments.toast_error'));
    } finally {
      setIcSubmitting(false);
    }
  };

  const handleDecline = async (apt: Appointment) => {
    if (!confirm(t('appointments.decline_confirm'))) return;
    try {
      await parentApi.declineInvite(apt.id);
      toast.success(t('appointments.declined'));
      parentApi.getAppointments().then(r => setAppointments(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('appointments.toast_error'));
    }
  };

  return (
    <PageLayout title={t('appointments.title')} subtitle={t('appointments.subtitle')}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Request form (left) */}
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
            <Input label={t('appointments.reason')} placeholder={t('appointments.reason_placeholder')} error={errors.reason?.message} {...register('reason', { required: t('appointments.reason_required') })} />
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

        {/* My Requests (right) */}
        <div>
        {loading ? <CardListSkeleton count={2} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : appointments.length === 0 ? (
          <EmptyState title={t('appointments.no_appointments')} icon={<Calendar className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">{t('appointments.my_requests')}</h2>
            <div className="space-y-3">
              {appointments.map(apt => apt.status === 'invited' ? (
                <Card key={apt.id} className="border-l-4 border-indigo-400">
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-medium text-gray-900">{t('appointments.invite_title')}</p>
                    <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">{t('appointments.status_invited')}</span>
                  </div>
                  {apt.invitedByName && <p className="text-xs text-gray-500">{t('appointments.invited_by', { name: apt.invitedByName })}</p>}
                  {apt.inviteReason && <p className="text-sm text-gray-700 mt-1">{apt.inviteReason}</p>}
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => openComplete(apt)}>{t('appointments.complete')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDecline(apt)}>{t('appointments.decline')}</Button>
                  </div>
                </Card>
              ) : (
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
      </div>

      <Modal isOpen={!!invite} onClose={() => setInvite(null)} title={t('appointments.complete_title')}>
        <div className="space-y-3">
          {invite?.inviteReason && (
            <p className="text-sm text-gray-500">{t('appointments.invite_reason')}: {invite.inviteReason}</p>
          )}
          <Input label={t('appointments.reason')} value={icReason} onChange={e => setIcReason(e.target.value)} placeholder={t('appointments.reason_placeholder')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('appointments.message')}</label>
            <textarea className="input-field min-h-[80px] resize-none" value={icMessage} onChange={e => setIcMessage(e.target.value)} placeholder={t('appointments.message_placeholder')} />
          </div>
          <Input label={t('appointments.preferred_date')} type="date" value={icDate} onChange={e => setIcDate(e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setInvite(null)}>{t('common.cancel')}</Button>
            <Button onClick={submitComplete} loading={icSubmitting}>{t('appointments.submit')}</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
