import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import type { Class, Homework } from '../../types';

export default function WriteHomeworkPage() {
  const { t } = useTranslation();
  const { subjectsForClass } = useTeacherProfile();
  const [classes, setClasses] = useState<Class[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const { register, handleSubmit, reset, watch, setValue, getValues } = useForm<{
    classId: string; title: string; description: string; dueDate: string; subject: string;
  }>();

  const selectedClass = watch('classId');
  const subjectOptions = subjectsForClass(selectedClass);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getHomework().then(r => setHomework(r.data || []));
  }, []);

  // Keep the subject field consistent with the selected class's curriculum.
  useEffect(() => {
    const opts = subjectsForClass(selectedClass);
    const current = getValues('subject');
    if (opts.length === 1) setValue('subject', opts[0].name);
    else if (current && !opts.some(o => o.name === current)) setValue('subject', '');
  }, [selectedClass, subjectsForClass]);

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
      toast.success(t('teacher.homework_posted'));
      reset();
      setFile(null);
      teacherApi.getHomework().then(r => setHomework(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.post_homework_failed'));
    } finally {
      setLoading(false);
    }
  };

  const filteredHW = selectedClass ? homework.filter(h => h.classId === selectedClass) : homework;

  return (
    <PageLayout title={t('teacher.write_homework')}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('teacher.new_homework')}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select label={t('common.class')} options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('teacher.select_class')} {...register('classId', { required: true })} />
            {subjectOptions.length === 0 ? (
              <p className="text-sm text-amber-600">{t('teacher.no_subject_for_class')}</p>
            ) : (
              <Select label={t('common.subject')} options={subjectOptions.map(s => ({ value: s.name, label: s.name }))} placeholder={t('teacher.select_subject')} {...register('subject', { required: true })} />
            )}
            <Input label={t('teacher.title_label')} placeholder={t('teacher.homework_title_ph')} {...register('title', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.description')}</label>
              <textarea className="input-field min-h-[100px] resize-none" placeholder={t('teacher.homework_desc_ph')} {...register('description')} />
            </div>
            <Input label={t('teacher.due_date')} type="date" {...register('dueDate')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('teacher.attachment_optional')}</label>
              <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 rounded-xl p-4 hover:border-primary-400 transition-colors">
                <Paperclip className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-500">{file ? file.name : t('teacher.click_attach')}</span>
                <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} accept=".pdf,.doc,.docx,.jpg,.png" />
              </label>
            </div>
            <Button type="submit" loading={loading} fullWidth icon={<BookOpen className="w-4 h-4" />}>{t('teacher.post_homework')}</Button>
          </form>
        </Card>

        {/* Current homework */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('teacher.posted_homework', { count: filteredHW.length })}</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredHW.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">{t('teacher.no_homework_posted')}</p>
            ) : filteredHW.map(hw => (
              <div key={hw.id} className="p-3 bg-gray-50 rounded-xl">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{hw.title}</p>
                    <p className="text-xs text-gray-500">{hw.subject} · {hw.classes?.name}</p>
                    {hw.dueDate && <p className="text-xs text-gray-400">{t('homework.due_label')} {hw.dueDate}</p>}
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(t('teacher.delete_homework_confirm'))) return;
                      try {
                        await teacherApi.deleteHomework(hw.id);
                        toast.success(t('teacher.homework_deleted'));
                        teacherApi.getHomework().then(r => setHomework(r.data || []));
                      } catch { toast.error(t('teacher.delete_failed')); }
                    }}
                    className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0 transition-colors"
                    title={t('teacher.delete_homework')}
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
