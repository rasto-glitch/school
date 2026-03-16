import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { FileText } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import SubjectBadge from '../../components/common/SubjectBadge';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Student } from '../../types';

export default function WriteReportPage() {
  const { subject: teacherSubject, loading: subjectLoading } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, reset, setValue } = useForm<{
    studentId: string; subject: string; attendanceNotes: string; behaviorNotes: string;
    quizMarks: number; examMarks: number; teacherNotes: string;
  }>();

  useEffect(() => { teacherApi.getClasses().then(r => setClasses(r.data || [])); }, []);

  useEffect(() => {
    if (teacherSubject) setValue('subject', teacherSubject);
  }, [teacherSubject]);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || []));
  }, [selectedClass]);

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      await teacherApi.createReport({ ...data, quizMarks: parseFloat(data.quizMarks), examMarks: parseFloat(data.examMarks) });
      toast.success('Report submitted!');
      reset();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout title="Write Report" subtitle="Submit student academic reports">
      <div className="max-w-xl">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">New Report</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select label="Class" options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="Select class" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} />
            <Select label="Student" options={students.map(s => ({ value: s.id, label: s.fullName }))} placeholder="Select student" {...register('studentId', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
              <SubjectBadge subject={teacherSubject} loading={subjectLoading} />
              <input type="hidden" {...register('subject', { required: true })} value={teacherSubject} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Quiz Marks" type="number" step="0.1" min="0" placeholder="0" {...register('quizMarks')} />
              <Input label="Exam Marks" type="number" step="0.1" min="0" placeholder="0" {...register('examMarks')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Attendance Notes</label>
              <textarea className="input-field min-h-[80px] resize-none" {...register('attendanceNotes')} placeholder="Attendance observations..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Behavior Notes</label>
              <textarea className="input-field min-h-[80px] resize-none" {...register('behaviorNotes')} placeholder="Behavior observations..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Teacher Notes</label>
              <textarea className="input-field min-h-[100px] resize-none" {...register('teacherNotes')} placeholder="Additional notes..." />
            </div>
            <Button type="submit" loading={loading} fullWidth icon={<FileText className="w-4 h-4" />}>Submit Report</Button>
          </form>
        </Card>
      </div>
    </PageLayout>
  );
}
