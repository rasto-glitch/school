import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Star } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import SubjectBadge from '../../components/common/SubjectBadge';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Student } from '../../types';

export default function GradingPage() {
  const { subject: teacherSubject, loading: subjectLoading } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [gradeSummary, setGradeSummary] = useState<any[]>([]);
  const [academicYear, setAcademicYear] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue } = useForm<{
    classId: string; studentId: string; subject: string;
    gradingPeriod: string; dailyGrade: number; quizGrade: number;
    monthlyExamGrade: number; termExamGrade: number;
  }>();

  const daily    = parseFloat(watch('dailyGrade') as any) || 0;
  const quiz     = parseFloat(watch('quizGrade') as any) || 0;
  const monthly  = parseFloat(watch('monthlyExamGrade') as any) || 0;
  const termExam = parseFloat(watch('termExamGrade') as any) || 0;
  const termTotal = daily + quiz + monthly + termExam;

  const studentId = watch('studentId');

  useEffect(() => { teacherApi.getClasses().then(r => setClasses(r.data || [])); }, []);
  useEffect(() => { teacherApi.getSettings().then(r => setAcademicYear(r.data?.currentAcademicYear || null)); }, []);

  useEffect(() => {
    if (teacherSubject) setValue('subject', teacherSubject);
  }, [teacherSubject]);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || []));
  }, [selectedClass]);

  const loadSummary = (sid: string) => {
    teacherApi.getGrades(sid).then(r => setGradeSummary(r.data || []));
  };

  useEffect(() => {
    setGradeSummary([]);
    if (studentId) loadSummary(studentId);
  }, [studentId]);

  // Group grade history by academic year
  const summaryByYear: Record<string, any[]> = {};
  for (const g of gradeSummary) {
    const year = g.academicYear || 'No Year';
    if (!summaryByYear[year]) summaryByYear[year] = [];
    summaryByYear[year].push(g);
  }
  const summaryYears = Object.keys(summaryByYear).sort();

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      await teacherApi.upsertGrade({
        ...data,
        dailyGrade: parseFloat(data.dailyGrade) || 0,
        quizGrade: parseFloat(data.quizGrade) || 0,
        monthlyExamGrade: parseFloat(data.monthlyExamGrade) || 0,
        termExamGrade: parseFloat(data.termExamGrade) || 0,
      });
      toast.success('Grade saved!');
      loadSummary(data.studentId);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save grade');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout title="Grading" subtitle="Enter student grades">
      <div className="max-w-xl space-y-6">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-gray-900">Enter Grade</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select
              label="Class"
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder="Select class"
              value={selectedClass}
              onChange={e => { setSelectedClass(e.target.value); setValue('classId', e.target.value); }}
            />
            <Select
              label="Student"
              options={students.map(s => ({ value: s.id, label: s.fullName }))}
              placeholder="Select student"
              {...register('studentId', { required: true })}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
              <SubjectBadge subject={teacherSubject} loading={subjectLoading} />
              <input type="hidden" {...register('subject', { required: true })} value={teacherSubject} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Academic Year</label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700">
                  {academicYear || <span className="text-gray-400 italic">Not set — contact admin</span>}
                </div>
              </div>
              <Input label="Grading Period" placeholder="e.g. Term 1" {...register('gradingPeriod')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Daily" type="number" step="0.1" min="0" max="100" placeholder="0" {...register('dailyGrade')} />
              <Input label="Quiz" type="number" step="0.1" min="0" max="100" placeholder="0" {...register('quizGrade')} />
              <Input label="Monthly Exam" type="number" step="0.1" min="0" max="100" placeholder="0" {...register('monthlyExamGrade')} />
              <Input label="Term Exam" type="number" step="0.1" min="0" max="100" placeholder="0" {...register('termExamGrade')} />
            </div>

            <div className="bg-primary-50 rounded-xl p-4 text-center">
              <p className="text-sm text-gray-600 mb-1">Term Total</p>
              <p className="text-3xl font-bold text-primary-600">{termTotal.toFixed(1)}</p>
            </div>

            <Button type="submit" loading={loading} fullWidth icon={<Star className="w-4 h-4" />}>Save Grade</Button>
          </form>
        </Card>

        {/* Grade history grouped by academic year */}
        {summaryYears.length > 0 && (
          <Card>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
              Grade History — {gradeSummary[0]?.subject}
            </p>
            <div className="space-y-5">
              {summaryYears.map(year => {
                const rows = summaryByYear[year];
                const yearMark = (
                  rows.reduce((sum, g) =>
                    sum + (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0), 0
                  ) / rows.length
                ).toFixed(1);

                return (
                  <div key={year}>
                    <p className="text-sm font-semibold text-gray-700 mb-2">{year}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">Period</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Daily</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Quiz</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Monthly</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Term Exam</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((g, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-3 py-2 border border-gray-200 text-gray-700">{g.gradingPeriod || '—'}</td>
                              <td className="px-3 py-2 border border-gray-200 text-center">{g.dailyGrade ?? '—'}</td>
                              <td className="px-3 py-2 border border-gray-200 text-center">{g.quizGrade ?? '—'}</td>
                              <td className="px-3 py-2 border border-gray-200 text-center">{g.monthlyExamGrade ?? '—'}</td>
                              <td className="px-3 py-2 border border-gray-200 text-center font-medium">{g.termExamGrade ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 bg-indigo-50 rounded-xl px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-gray-500">Full Year Mark ({rows.length} term{rows.length !== 1 ? 's' : ''})</span>
                      <span className="text-sm font-bold text-indigo-600">{yearMark}</span>
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
