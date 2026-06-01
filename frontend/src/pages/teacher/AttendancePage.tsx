import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CheckCircle2, XCircle, Clock, Save, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Class, Student } from '../../types';

type AttendanceStatus = 'present' | 'absent' | 'late';

interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  notes: string;
}

// Today's date in the school's timezone (YYYY-MM-DD). Falls back to
// Asia/Baghdad for users whose cached payload predates the timezone field.
function todayInTz(tz: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function offsetDate(base: string, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function AttendancePage() {
  const { t } = useTranslation();
  const tz = useAuthStore(s => s.school?.timezone);
  const today = todayInTz(tz);
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [date, setDate] = useState(today);
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);

  useEffect(() => {
    teacherApi.getClasses().then(r => {
      const cls: Class[] = r.data || [];
      setClasses(cls);
      if (cls.length > 0) setSelectedClass(cls[0].id);
    });
  }, []);

  // Load students and existing attendance whenever class or date changes
  useEffect(() => {
    if (!selectedClass) return;
    setLoadingStudents(true);
    Promise.all([
      teacherApi.getStudents({ classId: selectedClass }),
      teacherApi.getAttendance(selectedClass, date),
    ]).then(([stuRes, attRes]) => {
      const studs: Student[] = stuRes.data || [];
      setStudents(studs);

      const existing: any[] = attRes.data || [];
      setAlreadySaved(existing.length > 0);

      // Pre-fill from existing records or default all to 'present'
      const init: Record<string, AttendanceRecord> = {};
      studs.forEach(s => {
        const found = existing.find((e: any) => e.studentId === s.id);
        init[s.id] = {
          studentId: s.id,
          status: found ? found.status : 'present',
          notes: found ? found.notes || '' : '',
        };
      });
      setRecords(init);
    }).catch(() => {
      toast.error(t('teacher.load_attendance_failed'));
    }).finally(() => setLoadingStudents(false));
  }, [selectedClass, date]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setRecords(prev => ({ ...prev, [studentId]: { ...prev[studentId], status } }));
  };

  const setNotes = (studentId: string, notes: string) => {
    setRecords(prev => ({ ...prev, [studentId]: { ...prev[studentId], notes } }));
  };

  const markAll = (status: AttendanceStatus) => {
    setRecords(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { ...next[id], status }; });
      return next;
    });
  };

  const onSave = async () => {
    if (!selectedClass) return;
    setSaving(true);
    try {
      await teacherApi.markAttendance({
        classId: selectedClass,
        date,
        records: Object.values(records),
      });
      toast.success(t('teacher.attendance_saved'));
      setAlreadySaved(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.save_attendance_failed'));
    } finally {
      setSaving(false);
    }
  };

  const statusCounts = Object.values(records).reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  // Past days are locked at midnight in the school's timezone (backend is
  // source of truth — this is just UI guidance). Teachers must ask a
  // supervisor to correct any record on a locked day.
  const locked = date < today;

  return (
    <PageLayout title={t('teacher.attendance_title')} subtitle={t('teacher.attendance_subtitle')}>
      <div className="space-y-4 max-w-3xl">
        {/* Controls */}
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
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.date')}</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDate(d => offsetDate(d, -1))}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-500" />
                  </button>
                  <input
                    type="date"
                    value={date}
                    max={today}
                    onChange={e => setDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    onClick={() => setDate(d => offsetDate(d, 1))}
                    disabled={date >= today}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
            {students.length > 0 && !locked && (
              <div className="flex gap-2 ml-auto">
                <button onClick={() => markAll('present')} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium transition-colors">
                  {t('teacher.all_present')}
                </button>
                <button onClick={() => markAll('absent')} className="text-xs px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-medium transition-colors">
                  {t('teacher.all_absent')}
                </button>
              </div>
            )}
            {locked && (
              <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full">
                <Lock className="w-3.5 h-3.5" /> {t('teacher.attendance_locked', 'Locked')}
              </span>
            )}
          </div>

          {/* Summary badges */}
          {students.length > 0 && (
            <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
              <span className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 px-3 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> {statusCounts.present || 0} {t('common.present')}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-red-700 bg-red-50 px-3 py-1 rounded-full">
                <XCircle className="w-3.5 h-3.5" /> {statusCounts.absent || 0} {t('common.absent')}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                <Clock className="w-3.5 h-3.5" /> {statusCounts.late || 0} {t('common.late')}
              </span>
              {alreadySaved && (
                <span className="ml-auto text-xs text-gray-400 italic self-center">{t('teacher.previously_saved')}</span>
              )}
            </div>
          )}
        </Card>

        {/* Student list */}
        {loadingStudents ? (
          <LoadingSpinner />
        ) : students.length === 0 ? (
          <Card><p className="text-sm text-gray-400 text-center py-4">{t('teacher.no_students_in_class')}</p></Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-gray-100">
              {students.map(student => {
                const rec = records[student.id];
                if (!rec) return null;
                return (
                  <div key={student.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      {student.profilePicture
                        ? <img src={student.profilePicture} className="w-9 h-9 rounded-full object-cover" alt="" />
                        : <span className="text-primary-700 font-bold text-sm">{student.fullName[0]}</span>
                      }
                    </div>
                    <span className="flex-1 text-sm font-medium text-gray-900">{student.fullName}</span>

                    {/* Status toggle */}
                    <div className="flex gap-1">
                      {(['present', 'absent', 'late'] as AttendanceStatus[]).map(s => (
                        <button
                          key={s}
                          onClick={() => !locked && setStatus(student.id, s)}
                          disabled={locked}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            rec.status === s
                              ? s === 'present' ? 'bg-green-500 text-white'
                                : s === 'absent' ? 'bg-red-500 text-white'
                                : 'bg-amber-500 text-white'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          } ${locked ? 'cursor-not-allowed opacity-80' : ''}`}
                        >
                          {t(`common.${s}`)}
                        </button>
                      ))}
                    </div>

                    {/* Notes — only visible for absent/late */}
                    {rec.status !== 'present' && (
                      <input
                        type="text"
                        value={rec.notes}
                        onChange={e => setNotes(student.id, e.target.value)}
                        disabled={locked}
                        placeholder={t('teacher.note_optional')}
                        className="w-36 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-500"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {students.length > 0 && !locked && (
          <Button fullWidth loading={saving} icon={<Save className="w-4 h-4" />} onClick={onSave}>
            {t('teacher.save_attendance')}
          </Button>
        )}
        {students.length > 0 && locked && (
          <div className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
            <Lock className="w-4 h-4" />
            <span>{t('teacher.attendance_locked_hint', 'This day is locked. Ask a supervisor to make any changes.')}</span>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
