import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Star, Plus, Trash2 } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Student, MarkType, Mark, Grade, Term } from '../../types';

export default function GradingPage() {
  const { t } = useTranslation();
  const { subjectsForClass } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [gradingPeriod, setGradingPeriod] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [gradeSummary, setGradeSummary] = useState<Grade[]>([]);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getMarkTypes('grade').then(r => setMarkTypes(r.data || []));
    teacherApi.getTerms().then(r => setTerms(r.data || []));
    teacherApi.getSettings().then(r => setAcademicYear(r.data?.currentAcademicYear || null));
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
    setGradeSummary([]);
    setMarks([]);
    setGradingPeriod('');
    if (selectedStudent) {
      teacherApi.getGrades(selectedStudent).then(r => setGradeSummary(r.data || []));
    }
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

  const onSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!selectedStudent || !selectedSubject) {
      toast.error(t('teacher.select_student_subject'));
      return;
    }
    setLoading(true);
    try {
      await teacherApi.upsertGrade({
        studentId: selectedStudent,
        classId: selectedClass,
        subject: selectedSubject,
        gradingPeriod,
        marks: marks.map(m => ({ name: m.name, value: parseFloat(String(m.value)) || 0 })),
      });
      toast.success(t('teacher.grade_saved'));
      teacherApi.getGrades(selectedStudent).then(r => setGradeSummary(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.save_grade_failed'));
    } finally {
      setLoading(false);
    }
  };

  // Only show history for the current academic year. Past years are not deleted —
  // they remain in the DB and are still visible to admins, parents, and exports.
  const visibleHistory = academicYear
    ? gradeSummary.filter(g => g.academicYear === academicYear)
    : gradeSummary;
  const summaryByYear: Record<string, Grade[]> = {};
  for (const g of visibleHistory) {
    const year = g.academicYear || 'No Year';
    if (!summaryByYear[year]) summaryByYear[year] = [];
    summaryByYear[year].push(g);
  }
  const summaryYears = Object.keys(summaryByYear).sort();

  return (
    <PageLayout title={t('teacher.grading_title')} subtitle={t('teacher.grading_subtitle')}>
      <div className="max-w-xl space-y-6">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-gray-900">{t('teacher.enter_grade')}</h2>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('teacher.academic_year')}</label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700">
                  {academicYear || <span className="text-gray-400 italic">{t('teacher.not_set')}</span>}
                </div>
              </div>
              <Select
                label={t('teacher.term')}
                options={terms.map(tm => ({ value: tm.name, label: tm.name }))}
                placeholder={terms.length ? t('teacher.select_term') : t('teacher.no_terms')}
                value={gradingPeriod}
                onChange={e => setGradingPeriod(e.target.value)}
              />
            </div>

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
                  <div className="bg-primary-50 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-sm text-gray-600">{t('common.total')}</span>
                    <span className="text-xl font-bold text-primary-600">{total.toFixed(1)}</span>
                  </div>
                </div>
              )}
            </div>

            <Button type="submit" loading={loading} fullWidth icon={<Star className="w-4 h-4" />}>
              {t('teacher.save_grade')}
            </Button>
          </form>
        </Card>

        {/* Grade history */}
        {summaryYears.length > 0 && (
          <Card>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
              {t('teacher.grade_history', { subject: gradeSummary[0]?.subject })}
            </p>
            <div className="space-y-5">
              {summaryYears.map(year => {
                const rows = summaryByYear[year];
                return (
                  <div key={year}>
                    <p className="text-sm font-semibold text-gray-700 mb-2">{year}</p>
                    <div className="space-y-2">
                      {rows.map((g, i) => {
                        const gradeMarks: Mark[] = g.marks || [];
                        const gradeTotal = gradeMarks.reduce((s, m) => s + m.value, 0);
                        return (
                          <div key={i} className="bg-gray-50 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700">
                                {g.gradingPeriod || '—'}
                              </span>
                              {gradeTotal > 0 && (
                                <span className="text-sm font-bold text-primary-600">
                                  {gradeTotal.toFixed(1)}
                                </span>
                              )}
                            </div>
                            {gradeMarks.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {gradeMarks.map((m, mi) => (
                                  <div key={mi} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-xs">
                                    <span className="text-gray-500">{m.name}: </span>
                                    <span className="font-semibold text-gray-800">{m.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">{t('teacher.no_marks_short')}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
