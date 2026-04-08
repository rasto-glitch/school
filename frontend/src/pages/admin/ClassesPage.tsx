import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { BookOpen, Plus, Tag, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Student, Teacher } from '../../types';

interface Subject { id: string; name: string; teacherId?: string; teachers?: { fullName?: string; full_name?: string } }


export default function ClassesPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectTeacherId, setNewSubjectTeacherId] = useState('');

  const { register, handleSubmit, reset } = useForm<{ name: string; gradeLevel: string; academicYear: string; assignStudents: string }>();

  const loadClasses = () => adminApi.getClasses().then(r => setClasses(r.data || []));
  const loadSubjects = () => adminApi.getSubjects().then(r => setSubjects(r.data || []));

  useEffect(() => {
    loadClasses();
    loadSubjects();
    adminApi.getStudents().then(r => setStudents(r.data?.students || []));
    adminApi.getTeachers().then(r => setTeachers(r.data || []));
  }, []);

  const onCreate = async (data: any) => {
    setCreating(true);
    try {
      await adminApi.createClass(data);
      toast.success('Class created!');
      reset();
      loadClasses();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create class');
    } finally {
      setCreating(false);
    }
  };

  const onCreateSubject = async () => {
    if (!newSubjectName.trim()) { toast.error('Enter a subject name'); return; }
    setCreatingSubject(true);
    try {
      await adminApi.createSubject({ name: newSubjectName.trim(), teacherId: newSubjectTeacherId || undefined });
      toast.success('Subject created!');
      setNewSubjectName('');
      setNewSubjectTeacherId('');
      loadSubjects();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create subject');
    } finally {
      setCreatingSubject(false); }
  };

  const onDeleteSubject = async (id: string) => {
    if (!confirm('Delete this subject?')) return;
    await adminApi.deleteSubject(id).catch(() => {});
    loadSubjects();
  };

  const onAssignTeacher = async (subjectId: string, teacherId: string) => {
    await adminApi.updateSubject(subjectId, { teacherId: teacherId || null });
    loadSubjects();
    toast.success('Teacher assigned to subject');
  };

  return (
    <PageLayout title="Class Management">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left column — Classes */}
        <div className="space-y-6">
          {/* Create Class */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-5 h-5 text-primary-600" />
              <h2 className="font-semibold text-gray-900">Create Class</h2>
            </div>
            <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
              <Input label="Class Name" placeholder="e.g. Grade 5A" {...register('name', { required: true })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Grade Level" placeholder="e.g. Grade 5" {...register('gradeLevel')} />
                <Input label="Academic Year" placeholder="e.g. 2024-2025" {...register('academicYear')} />
              </div>
              <Select
                label="Assign Students to Class"
                options={students.map(s => ({ value: s.id, label: s.fullName }))}
                placeholder="Select students (assign later)"
                {...register('assignStudents')}
              />
              <Button type="submit" loading={creating} fullWidth icon={<BookOpen className="w-4 h-4" />}>
                Create Class
              </Button>
            </form>
          </Card>

          {/* Existing classes */}
          {classes.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Existing Classes ({classes.length})
              </h2>
              <div className="space-y-2">
                {classes.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      {(c as any).gradeLevel && <p className="text-xs text-gray-400">{(c as any).gradeLevel}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 whitespace-nowrap">Next class</span>
                      <select
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        value={(c as any).nextClassId || ''}
                        onChange={async e => {
                          const nextClassId = e.target.value || null;
                          try {
                            await adminApi.updateClass(c.id, { nextClassId });
                            loadClasses();
                          } catch {
                            toast.error('Failed to update next class');
                          }
                        }}
                      >
                        <option value="">None (graduating class)</option>
                        {classes.filter(oc => oc.id !== c.id).map(oc => (
                          <option key={oc.id} value={oc.id}>{oc.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete class "${c.name}"?`)) return;
                          try {
                            await adminApi.deleteClass(c.id);
                            loadClasses();
                            toast.success('Class deleted');
                          } catch {
                            toast.error('Failed to delete class');
                          }
                        }}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column — Subjects */}
        <div className="space-y-6">
          {/* Create subject */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-primary-600" />
              <h3 className="font-semibold text-gray-900">Create Subject</h3>
            </div>
            <div className="space-y-3">
              <Input placeholder="Subject name (e.g. Mathematics)" value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)} />
              <Select
                options={teachers.map(t => ({ value: t.id, label: t.fullName || '' }))}
                placeholder="Assign teacher (optional)"
                value={newSubjectTeacherId}
                onChange={e => setNewSubjectTeacherId(e.target.value)}
              />
              <Button onClick={onCreateSubject} loading={creatingSubject} fullWidth icon={<Plus className="w-4 h-4" />}>Add Subject</Button>
            </div>
          </Card>

          {/* Subjects list */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">All Subjects ({subjects.length})</h3>
            {subjects.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No subjects yet</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {subjects.map(s => (
                  <div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                    <span className="flex-1 text-sm font-medium text-gray-900">{s.name}</span>
                    <div className="w-36">
                      <select
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                        value={s.teacherId || ''}
                        onChange={e => onAssignTeacher(s.id, e.target.value)}
                      >
                        <option value="">No teacher</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>{t.fullName}</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => onDeleteSubject(s.id)} className="p-1 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
