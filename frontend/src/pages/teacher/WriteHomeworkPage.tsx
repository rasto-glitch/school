import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { BookOpen, Paperclip, Trash2 } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import SubjectBadge from '../../components/common/SubjectBadge';
import type { Class, Homework } from '../../types';

export default function WriteHomeworkPage() {
  const { subject: teacherSubject, loading: subjectLoading } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const { register, handleSubmit, reset, watch, setValue } = useForm<{
    classId: string; title: string; description: string; dueDate: string; subject: string;
  }>();

  const selectedClass = watch('classId');

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getHomework().then(r => setHomework(r.data || []));
  }, []);

  // Auto-fill subject when teacher profile loads
  useEffect(() => {
    if (teacherSubject) setValue('subject', teacherSubject);
  }, [teacherSubject]);

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      if (file) {
        const fd = new FormData();
        Object.entries(data).forEach(([k, v]) => { if (v) fd.append(k, v as string); });
        fd.append('attachment', file);
        await teacherApi.createHomework(fd);
      } else {
        await teacherApi.createHomework(data);
      }
      toast.success('Homework posted!');
      reset();
      setFile(null);
      teacherApi.getHomework().then(r => setHomework(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to post homework');
    } finally {
      setLoading(false);
    }
  };

  const filteredHW = selectedClass ? homework.filter(h => h.classId === selectedClass) : homework;

  return (
    <PageLayout title="Write Homework">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">New Homework</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select label="Class" options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="Select class" {...register('classId', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
              <SubjectBadge subject={teacherSubject} loading={subjectLoading} />
              <input type="hidden" {...register('subject', { required: true })} value={teacherSubject} />
            </div>
            <Input label="Title" placeholder="Homework title" {...register('title', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
              <textarea className="input-field min-h-[100px] resize-none" placeholder="Homework description..." {...register('description')} />
            </div>
            <Input label="Due Date" type="date" {...register('dueDate')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Attachment (optional)</label>
              <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 rounded-xl p-4 hover:border-primary-400 transition-colors">
                <Paperclip className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-500">{file ? file.name : 'Click to attach file'}</span>
                <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} accept=".pdf,.doc,.docx,.jpg,.png" />
              </label>
            </div>
            <Button type="submit" loading={loading} fullWidth icon={<BookOpen className="w-4 h-4" />}>Post Homework</Button>
          </form>
        </Card>

        {/* Current homework */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Posted Homework ({filteredHW.length})</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredHW.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No homework posted yet</p>
            ) : filteredHW.map(hw => (
              <div key={hw.id} className="p-3 bg-gray-50 rounded-xl">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{hw.title}</p>
                    <p className="text-xs text-gray-500">{hw.subject} · {hw.classes?.name}</p>
                    {hw.dueDate && <p className="text-xs text-gray-400">Due: {hw.dueDate}</p>}
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('Delete this homework?')) return;
                      try {
                        await teacherApi.deleteHomework(hw.id);
                        toast.success('Homework deleted');
                        teacherApi.getHomework().then(r => setHomework(r.data || []));
                      } catch { toast.error('Failed to delete'); }
                    }}
                    className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0 transition-colors"
                    title="Delete homework"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
