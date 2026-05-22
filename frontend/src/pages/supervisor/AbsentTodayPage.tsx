import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, XCircle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Attendance } from '../../types';

export default function AbsentTodayPage() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = () => {
    supervisorApi.getAbsentToday()
      .then(r => setRecords(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const markPresent = async (record: Attendance) => {
    setUpdatingId(record.id);
    try {
      await supervisorApi.updateAttendanceRecord(record.id, 'present');
      toast.success(t('supervisor.marked_present_toast', { name: record.students?.fullName }));
      setRecords(prev => prev.filter(r => r.id !== record.id));
    } catch {
      toast.error(t('supervisor.update_attendance_failed'));
    } finally {
      setUpdatingId(null);
    }
  };

  const absent = records.filter(r => r.status === 'absent');
  const late = records.filter(r => r.status === 'late');

  return (
    <PageLayout
      title={t('supervisor.absent_today')}
      subtitle={`${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
    >
      <div className="space-y-6 max-w-2xl">
        {loading ? <LoadingSpinner /> : records.length === 0 ? (
          <Card className="text-center py-10">
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-gray-800">{t('supervisor.all_present_today')}</p>
            <p className="text-sm text-gray-400 mt-1">{t('supervisor.no_absences')}</p>
          </Card>
        ) : (
          <>
            {absent.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <XCircle className="w-5 h-5 text-red-500" />
                  <h2 className="font-semibold text-gray-900">{t('common.absent')} ({absent.length})</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {absent.map(r => (
                    <StudentRow key={r.id} record={r} onMarkPresent={markPresent} updatingId={updatingId} />
                  ))}
                </div>
              </Card>
            )}

            {late.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-amber-500" />
                  <h2 className="font-semibold text-gray-900">{t('common.late')} ({late.length})</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {late.map(r => (
                    <StudentRow key={r.id} record={r} onMarkPresent={markPresent} updatingId={updatingId} />
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}

function StudentRow({ record, onMarkPresent, updatingId }: {
  record: Attendance;
  onMarkPresent: (r: Attendance) => void;
  updatingId: string | null;
}) {
  const { t } = useTranslation();
  const student = record.students;
  const parent = student?.parents;

  return (
    <div className="py-3 flex items-start gap-3">
      <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-primary-700 font-bold text-sm">{student?.fullName?.[0] ?? '?'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{student?.fullName}</p>
        <p className="text-xs text-gray-500">{(student as any)?.classes?.name ?? '—'}</p>
        {record.notes && <p className="text-xs text-gray-400 mt-0.5 italic">"{record.notes}"</p>}
        {record.teachers && <p className="text-xs text-gray-400">{t('supervisor.marked_by', { name: record.teachers.fullName })}</p>}
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {parent?.phoneNumber && (
          <a
            href={`tel:${parent.phoneNumber}`}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
          >
            <Phone className="w-3 h-3" />
            {parent.phoneNumber}
          </a>
        )}
        <button
          onClick={() => onMarkPresent(record)}
          disabled={updatingId === record.id}
          className="text-xs bg-green-50 hover:bg-green-100 text-green-700 font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
        >
          {updatingId === record.id ? t('common.saving') : t('supervisor.mark_present')}
        </button>
      </div>
    </div>
  );
}
