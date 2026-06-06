import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { FileText, Plus, Trash2, Share2, Lock } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Student, MarkType, Mark } from '../../types';

export default function WriteReportPage() {
  const { t } = useTranslation();
  const { subjectsForClass } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [behaviorNotes, setBehaviorNotes] = useState('');
  const [teacherNotes, setTeacherNotes] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [loading, setLoading] = useState(false);
  // PR 2 — per-report share toggle. Defaults off (private to same-subject
  // colleagues + admin only). Visible only when the school enables the
  // teacher_report_handoff feature; when the feature is off the report
  // stays in the "my work" lane regardless and the toggle is hidden.
  const [shared, setShared] = useState(false);
  const handoffEnabled = useAuthStore(s => s.school?.features?.teacher_report_handoff !== false);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getMarkTypes('report').then(r => setMarkTypes(r.data || []));
  }, []);

  const subjectOptions = subjectsForClass(selectedClass);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || []));
  }, [selectedClass]);

  // Keep the subject in sync with the selected class's curriculum.
  useEffect(() => {
    const opts = subjectsForClass(selectedClass);
    if (opts.length === 1) setSelectedSubject(opts[0].name);
    else setSelectedSubject(prev => (prev && opts.some(o => o.name === prev) ? prev : ''));
  }, [selectedClass, subjectsForClass]);

  useEffect(() => {
    setMarks([]);
    setAttendanceNotes('');
    setBehaviorNotes('');
    setTeacherNotes('');
  }, [selectedStudent]);

  const addMark = () => {
    const defaultName = markTypes[0]?.name || '';
    setMarks(prev => [...prev, { name: defaultName, value: 0 }]);
  };

  const updateMark = (i: number, field: 'name' | 'value', val: string | number) => {
    setMarks(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  };

  const removeMark = (i: number) => {
    setMarks(prev => prev.filter((_, idx) => idx !== i));
  };

  const total = marks.reduce((sum, m) => sum + (parseFloat(String(m.value)) || 0), 0);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !selectedSubject) {
      toast.error(t('teacher.select_student_subject'));
      return;
    }
    setLoading(true);
    try {
      await teacherApi.createReport({
        studentId: selectedStudent,
        subject: selectedSubject,
        attendanceNotes,
        behaviorNotes,
        teacherNotes,
        marks: marks.map(m => ({ name: m.name, value: parseFloat(String(m.value)) || 0 })),
        sharedWithOtherTeachers: shared,
      });
      toast.success(t('teacher.report_submitted'));
      setSelectedStudent('');
      setAttendanceNotes('');
      setBehaviorNotes('');
      setTeacherNotes('');
      setMarks([]);
      setShared(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.submit_report_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout title={t('teacher.write_report')} subtitle={t('teacher.write_report_subtitle')}>
      <div className="max-w-xl">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">{t('teacher.new_report')}</h2>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <Select
              label={t('common.class')}
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder={t('teacher.select_class')}
              value={selectedClass}
              onChange={e => { setSelectedClass(e.target.value); setSelectedStudent(''); }}
            />
            <Select
              label={t('common.student')}
              options={students.map(s => ({ value: s.id, label: s.fullName }))}
              placeholder={t('teacher.select_student')}
              value={selectedStudent}
              onChange={e => setSelectedStudent(e.target.value)}
            />
            {selectedClass && (subjectOptions.length === 0 ? (
              <p className="text-sm text-amber-600">{t('teacher.no_subject_for_class')}</p>
            ) : (
              <Select
                label={t('common.subject')}
                options={subjectOptions.map(s => ({ value: s.name, label: s.name }))}
                placeholder={t('teacher.select_subject')}
                value={selectedSubject}
                onChange={e => setSelectedSubject(e.target.value)}
              />
            ))}

            {/* Dynamic marks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">{t('teacher.marks')}</label>
                <button
                  type="button"
                  onClick={addMark}
                  className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('teacher.add_mark')}
                </button>
              </div>

              {marks.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-400">{t('teacher.no_marks')}</p>
                  <button
                    type="button"
                    onClick={addMark}
                    className="mt-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {t('teacher.add_first_mark')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {marks.map((m, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      {markTypes.length > 0 ? (
                        <select
                          value={m.name}
                          onChange={e => updateMark(i, 'name', e.target.value)}
                          className="input-field flex-1 text-sm"
                        >
                          {markTypes.map(mt => (
                            <option key={mt.id} value={mt.name}>{mt.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={m.name}
                          onChange={e => updateMark(i, 'name', e.target.value)}
                          placeholder={t('teacher.mark_name')}
                          className="input-field flex-1 text-sm"
                        />
                      )}
                      <input
                        type="number"
                        value={m.value}
                        onChange={e => updateMark(i, 'value', e.target.value)}
                        step="0.1"
                        min="0"
                        placeholder="0"
                        className="input-field w-24 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeMark(i)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {marks.length > 1 && (
                    <div className="flex justify-end pt-1">
                      <span className="text-sm font-semibold text-gray-700">
                        {t('common.total')}: <span className="text-primary-600">{total.toFixed(1)}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('teacher.attendance_notes')}</label>
              <textarea
                className="input-field min-h-[80px] resize-none"
                value={attendanceNotes}
                onChange={e => setAttendanceNotes(e.target.value)}
                placeholder={t('teacher.attendance_notes_ph')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('teacher.behavior_notes')}</label>
              <textarea
                className="input-field min-h-[80px] resize-none"
                value={behaviorNotes}
                onChange={e => setBehaviorNotes(e.target.value)}
                placeholder={t('teacher.behavior_notes_ph')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('reports.teacher_notes')}</label>
              <textarea
                className="input-field min-h-[100px] resize-none"
                value={teacherNotes}
                onChange={e => setTeacherNotes(e.target.value)}
                placeholder={t('teacher.additional_notes_ph')}
              />
            </div>

            {handoffEnabled && (
              <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:border-gray-300 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={shared}
                  onChange={e => setShared(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                    {shared ? <Share2 className="w-3.5 h-3.5 text-emerald-600" /> : <Lock className="w-3.5 h-3.5 text-gray-400" />}
                    <span>{t('teacher.share_report_label')}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{t('teacher.share_report_help')}</p>
                </div>
              </label>
            )}

            <Button type="submit" loading={loading} fullWidth icon={<FileText className="w-4 h-4" />}>
              {t('teacher.submit_report')}
            </Button>
          </form>
        </Card>
      </div>
    </PageLayout>
  );
}
