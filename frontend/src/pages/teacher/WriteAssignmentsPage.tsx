import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { ClipboardList, Trash2, Paperclip, X } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import type { Class, Assignment, Student } from '../../types';

export default function WriteAssignmentsPage() {
  const { t } = useTranslation();
  const { subjectsForClass } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');

  const { register, handleSubmit, reset, watch, setValue, getValues } = useForm<{
    classId: string; studentId: string; title: string; description: string; dueDate: string; subject: string;
  }>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  const watchedClass = watch('classId');
  const subjectOptions = subjectsForClass(watchedClass);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getAssignments().then(r => setAssignments(r.data || []));
  }, []);

  useEffect(() => {
    const opts = subjectsForClass(watchedClass);
    const current = getValues('subject');
    if (opts.length === 1) setValue('subject', opts[0].name);
    else if (current && !opts.some(o => o.name === current)) setValue('subject', '');
  }, [watchedClass, subjectsForClass]);

  useEffect(() => {
    if (!watchedClass) return;
    setSelectedClass(watchedClass);
    teacherApi.getStudents({ classId: watchedClass }).then(r => setStudents(r.data || []));
  }, [watchedClass]);

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      let payload: FormData | object = data;
      if (attachedFile) {
        const fd = new FormData();
        Object.entries(data).forEach(([k, v]) => { if (v != null && v !== '') fd.append(k, String(v)); });
        fd.append('attachment', attachedFile);
        payload = fd;
      }
      await teacherApi.createAssignment(payload);
      toast.success(t('teacher.assignment_posted'));
      reset();
      setAttachedFile(null);
      if (fileRef.current) fileRef.current.value = '';
      teacherApi.getAssignments().then(r => setAssignments(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.post_assignment_failed'));
    } finally {
      setLoading(false);
    }
  };

  const filteredAssignments = selectedClass
    ? assignments.filter(a => (a as any).classId === selectedClass)
    : assignments;

  const statusColors: Record<string, 'yellow' | 'gray' | 'green'> = {
    pending: 'yellow', submitted: 'gray', graded: 'green',
  };

  return (
    <PageLayout title={t('teacher.write_assignment')}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('teacher.new_assignment')}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select label={t('common.class')} options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('teacher.select_class')} {...register('classId', { required: true })} />
            <Select label={t('teacher.student_optional')} options={students.map(s => ({ value: s.id, label: s.fullName }))} placeholder={t('teacher.all_students_in_class')} {...register('studentId')} />
            {subjectOptions.length === 0 ? (
              <p className="text-sm text-amber-600">{t('teacher.no_subject_for_class')}</p>
            ) : (
              <Select label={t('common.subject')} options={subjectOptions.map(s => ({ value: s.name, label: s.name }))} placeholder={t('teacher.select_subject')} {...register('subject', { required: true })} />
            )}
            <Input label={t('teacher.title_label')} placeholder={t('teacher.assignment_title_ph')} {...register('title', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.description')}</label>
              <textarea className="input-field min-h-[100px] resize-none" placeholder={t('teacher.assignment_desc_ph')} {...register('description')} />
            </div>
            <Input label={t('teacher.due_date')} type="date" {...register('dueDate')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('teacher.attachment_optional')}</label>
              <input ref={fileRef} type="file" className="hidden" onChange={e => setAttachedFile(e.target.files?.[0] || null)} />
              {attachedFile ? (
                <div className="flex items-center gap-2 p-2.5 bg-primary-50 border border-primary-200 rounded-xl text-sm">
                  <Paperclip className="w-4 h-4 text-primary-600 flex-shrink-0" />
                  <span className="flex-1 truncate text-primary-700 font-medium">{attachedFile.name}</span>
                  <button type="button" onClick={() => { setAttachedFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                    <X className="w-4 h-4 text-primary-400 hover:text-primary-600" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors w-full">
                  <Paperclip className="w-4 h-4" /> {t('teacher.attach_file')}
                </button>
              )}
            </div>
            <Button type="submit" loading={loading} fullWidth icon={<ClipboardList className="w-4 h-4" />}>{t('teacher.post_assignment')}</Button>
          </form>
        </Card>

        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('teacher.posted_assignments', { count: filteredAssignments.length })}</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredAssignments.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">{t('teacher.no_assignments_posted')}</p>
            ) : filteredAssignments.map(a => (
              <div key={a.id} className="p-3 bg-gray-50 rounded-xl">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                    <p className="text-xs text-gray-500">{a.subject} · {(a as any).classes?.name || (a as any).classId}</p>
                    {(a as any).students && <p className="text-xs text-gray-400">{(a as any).students.fullName}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={statusColors[a.submissionStatus] || 'gray'}>{t(`assignments.status_${a.submissionStatus}`, { defaultValue: a.submissionStatus })}</Badge>
                      {a.dueDate && <span className="text-xs text-gray-400">{t('homework.due_label')} {a.dueDate}</span>}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(t('teacher.delete_assignment_confirm'))) return;
                      try {
                        await teacherApi.deleteAssignment(a.id);
                        toast.success(t('teacher.assignment_deleted'));
                        teacherApi.getAssignments().then(r => setAssignments(r.data || []));
                      } catch { toast.error(t('teacher.delete_failed')); }
                    }}
                    className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0 transition-colors"
                    title={t('teacher.delete_assignment')}
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
