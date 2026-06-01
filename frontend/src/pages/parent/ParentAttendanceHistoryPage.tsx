import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Select from '../../components/common/Select';
import Card from '../../components/common/Card';
import AttendanceHistoryView, {
  type HistoryYear,
  type DayEntry,
} from '../../components/attendance/AttendanceHistoryView';

interface Child { id: string; fullName?: string; full_name?: string }

export default function ParentAttendanceHistoryPage() {
  const { t } = useTranslation();
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [loading, setLoading] = useState(false);
  const [years, setYears] = useState<HistoryYear[]>([]);
  const [studentName, setStudentName] = useState('');

  useEffect(() => {
    parentApi.getChildren()
      .then(r => {
        const list: Child[] = r.data ?? [];
        setChildren(list);
        if (list.length === 1) setSelectedChildId(list[0].id);
      })
      .catch(() => toast.error(t('common.error')));
  }, [t]);

  useEffect(() => {
    if (!selectedChildId) { setYears([]); setStudentName(''); return; }
    setLoading(true);
    parentApi.getChildAttendanceHistory(selectedChildId)
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
  }, [selectedChildId, t]);

  const loadDays = useCallback(async (year: string) => {
    if (!selectedChildId) return null;
    try {
      const r = await parentApi.getChildAttendanceDays(selectedChildId, year);
      return { days: (r.data?.days ?? []) as DayEntry[], startedOn: r.data?.startedOn ?? null, endedOn: r.data?.endedOn ?? null };
    } catch {
      return null;
    }
  }, [selectedChildId]);

  return (
    <PageLayout
      title={t('attendance_history.parent_title', 'Attendance')}
      subtitle={t('attendance_history.parent_subtitle', 'Day-by-day attendance and per-year totals.')}
    >
      <div className="space-y-4">
        {/* Child picker */}
        {children.length > 0 && (
          <Card>
            <div className="max-w-xs">
              <Select
                label={t('attendance_history.choose_child', 'Choose child')}
                options={children.map(c => ({ value: c.id, label: c.fullName || c.full_name || '' }))}
                placeholder={t('attendance_history.choose_child_ph', '— pick a child —')}
                value={selectedChildId}
                onChange={e => setSelectedChildId(e.target.value)}
              />
            </div>
          </Card>
        )}

        {selectedChildId && (
          <AttendanceHistoryView
            loading={loading}
            years={years}
            studentName={studentName}
            loadDays={loadDays}
          />
        )}
      </div>
    </PageLayout>
  );
}
