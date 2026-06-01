import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import AttendanceHistoryView, {
  type HistoryYear,
  type DayEntry,
} from '../../components/attendance/AttendanceHistoryView';

export default function StudentAttendanceHistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState<HistoryYear[]>([]);
  const [studentName, setStudentName] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    adminApi.getStudentAttendanceHistory(id)
      .then(r => {
        setYears(r.data?.years ?? []);
        setStudentName(r.data?.student?.fullName ?? '');
      })
      .catch((err: any) => {
        if (err?.response?.status === 403) {
          toast.error(t('attendance_history.archive_required', 'Attendance history requires the archive feature.'));
        } else {
          toast.error(t('common.error'));
        }
      })
      .finally(() => setLoading(false));
  }, [id, t]);

  const loadDays = useCallback(async (year: string) => {
    if (!id) return null;
    try {
      const r = await adminApi.getStudentAttendanceDays(id, year);
      return { days: (r.data?.days ?? []) as DayEntry[], startedOn: r.data?.startedOn ?? null, endedOn: r.data?.endedOn ?? null };
    } catch {
      return null;
    }
  }, [id]);

  return (
    <PageLayout
      title={t('attendance_history.title', 'Attendance history')}
      subtitle={studentName || undefined}
    >
      <div className="space-y-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-primary-600"
        >
          <ArrowLeft className="w-4 h-4" /> {t('common.back')}
        </button>
        <AttendanceHistoryView
          loading={loading}
          years={years}
          studentName={studentName}
          loadDays={loadDays}
        />
      </div>
    </PageLayout>
  );
}
