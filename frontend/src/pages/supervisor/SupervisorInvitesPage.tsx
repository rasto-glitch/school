import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { UserPlus, Calendar } from 'lucide-react';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Modal from '../../components/common/Modal';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { format, parseISO } from 'date-fns';

// Phase D — supervisor invites the parent of a student to a meeting. The parent
// completes it into a booking (or declines); reception then confirms + assigns
// an admin. This page sends invites + tracks their status.

interface Invite {
  id: string;
  inviteReason?: string;
  status: string;
  createdAt: string;
  scheduledDate?: string;
  parents?: { fullName?: string; full_name?: string };
}
interface StudentLite { id: string; fullName: string }

const statusColors: Record<string, 'yellow' | 'green' | 'red'> = {
  invited: 'yellow', pending: 'yellow', approved: 'green', rejected: 'red',
};

export default function SupervisorInvitesPage() {
  const { t } = useTranslation();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => supervisorApi.getMyInvites().then(r => setInvites(r.data || [])).finally(() => setLoading(false));
  useEffect(() => {
    load();
    supervisorApi.getAllStudents()
      .then(r => setStudents((r.data || []).map((s: any) => ({ id: s.id, fullName: s.fullName || s.full_name }))))
      .catch(() => {});
  }, []);

  const send = async () => {
    if (!studentId) { toast.error(t('supervisor.invites.pick_student')); return; }
    setSending(true);
    try {
      await supervisorApi.createInvite({ studentId, inviteReason: reason.trim() || undefined });
      toast.success(t('supervisor.invites.sent'));
      setOpen(false); setStudentId(''); setReason('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('supervisor.invites.send_failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <PageLayout title={t('supervisor.invites.title')} subtitle={t('supervisor.invites.subtitle')}>
      <div className="flex justify-end mb-4">
        <Button icon={<UserPlus className="w-4 h-4" />} onClick={() => setOpen(true)}>{t('supervisor.invites.new_invite')}</Button>
      </div>

      {loading ? <LoadingSpinner /> : invites.length === 0 ? (
        <EmptyState icon={<UserPlus className="w-8 h-8 text-gray-400" />} title={t('supervisor.invites.none')} />
      ) : (
        <div className="space-y-3 max-w-2xl">
          {invites.map(iv => (
            <Card key={iv.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{iv.parents?.fullName || iv.parents?.full_name || t('reception.parent_fallback')}</p>
                  {iv.inviteReason && <p className="text-sm text-gray-500 mt-0.5">{iv.inviteReason}</p>}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />{format(parseISO(iv.createdAt), 'MMM d, yyyy')}
                    {iv.scheduledDate ? ` · ${t('appointments.scheduled')}: ${iv.scheduledDate}` : ''}
                  </p>
                </div>
                <Badge color={statusColors[iv.status] || 'gray'}>{t(`appointments.status_${iv.status}`, { defaultValue: iv.status })}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('supervisor.invites.new_invite')}>
        <div className="space-y-3">
          <Select
            label={t('supervisor.invites.student')}
            options={students.map(s => ({ value: s.id, label: s.fullName }))}
            placeholder={students.length ? t('supervisor.invites.pick_student') : t('supervisor.invites.no_students')}
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('supervisor.invites.reason')}</label>
            <textarea className="input-field min-h-[90px] resize-none" placeholder={t('supervisor.invites.reason_ph')} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={send} loading={sending}>{t('supervisor.invites.send')}</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
