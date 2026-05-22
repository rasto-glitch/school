import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Class, Attendance } from '../../types';

type AttendanceStatus = 'present' | 'absent' | 'late';

function todayStr() { return new Date().toISOString().split('T')[0]; }
function offsetDate(base: string, days: number) {
  const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0];
}

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700',
  absent: 'bg-red-100 text-red-700',
  late: 'bg-amber-100 text-amber-700',
};
const STATUS_ICONS: Record<AttendanceStatus, React.ElementType> = {
  present: CheckCircle2, absent: XCircle, late: Clock,
};

export default function AttendanceOverviewPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [classes, setClasses] = useState<Class[]>([]);
  const [records, setRecords] = useState<Attendance[]>([]);
  const [selectedClass, setSelectedClass] = useState(searchParams.get('classId') || '');
  const [date, setDate] = useState(searchParams.get('date') || todayStr());
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('present');

  useEffect(() => {
    supervisorApi.getClasses().then(r => {
      const cls: Class[] = r.data || [];
      setClasses(cls);
      if (!selectedClass && cls.length > 0) setSelectedClass(cls[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    setLoading(true);
    supervisorApi.getAttendanceByClass(selectedClass, date)
      .then(r => setRecords(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClass, date]);

  const saveEdit = async (id: string) => {
    try {
      await supervisorApi.updateAttendanceRecord(id, editStatus);
      toast.success(t('supervisor.attendance_updated'));
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: editStatus } : r));
      setEditingId(null);
    } catch {
      toast.error(t('supervisor.update_failed'));
    }
  };

  const counts = records.reduce((acc, r) => {
    acc[r.status as AttendanceStatus] = (acc[r.status as AttendanceStatus] || 0) + 1; return acc;
  }, {} as Record<AttendanceStatus, number>);

  return (
    <PageLayout title={t('supervisor.attendance_overview')} subtitle={t('supervisor.attendance_overview_subtitle')}>
      <div className="space-y-4 max-w-3xl">
        <Card>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="w-48">
              <Select
                label={t('common.class')}
                options={classes.map(c => ({ value: c.id, label: c.name }))}
                value={selectedClass}
                onChange={e => setSelectedClass(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.date')}</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setDate(d => offsetDate(d, -1))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                  <ChevronLeft className="w-4 h-4 text-gray-500" />
                </button>
                <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                <button onClick={() => setDate(d => offsetDate(d, 1))} disabled={date >= todayStr()} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>
          </div>
          {records.length > 0 && (
            <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
              {(['present', 'absent', 'late'] as AttendanceStatus[]).map(s => {
                const Icon = STATUS_ICONS[s];
                return (
                  <span key={s} className={`flex items-center gap-1.5 text-sm px-3 py-1 rounded-full font-medium ${STATUS_STYLES[s]}`}>
                    <Icon className="w-3.5 h-3.5" /> {counts[s] || 0} {t(`common.${s}`)}
                  </span>
                );
              })}
            </div>
          )}
        </Card>

        {loading ? <LoadingSpinner /> : records.length === 0 ? (
          <Card><p className="text-sm text-gray-400 text-center py-6">{t('supervisor.no_attendance_class_date')}</p></Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-gray-100">
              {records.map(r => {
                const Icon = STATUS_ICONS[r.status as AttendanceStatus] ?? CheckCircle2;
                const isEditing = editingId === r.id;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-sm">{r.students?.fullName?.[0] ?? '?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{r.students?.fullName}</p>
                      {r.notes && <p className="text-xs text-gray-400 italic">"{r.notes}"</p>}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <select value={editStatus} onChange={e => setEditStatus(e.target.value as AttendanceStatus)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500">
                          <option value="present">{t('common.present')}</option>
                          <option value="absent">{t('common.absent')}</option>
                          <option value="late">{t('common.late')}</option>
                        </select>
                        <button onClick={() => saveEdit(r.id)} className="text-xs bg-primary-500 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-primary-600">{t('common.save')}</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <>
                        <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[r.status as AttendanceStatus] ?? ''}`}>
                          <Icon className="w-3 h-3" />
                          {t(`common.${r.status}`)}
                        </span>
                        <button onClick={() => { setEditingId(r.id); setEditStatus(r.status as AttendanceStatus); }}
                          className="text-xs text-gray-400 hover:text-primary-600 transition-colors">{t('common.edit')}</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
