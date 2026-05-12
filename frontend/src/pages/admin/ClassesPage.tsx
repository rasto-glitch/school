import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { BookOpen, Plus, Search, Tag, Trash2, Users } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import type { Class, Student, Teacher } from '../../types';

interface Subject { id: string; name: string; teacherId?: string; teachers?: { id: string; fullName: string }[] }


export default function ClassesPage() {
  const [activeTab, setActiveTab] = useState<'classes' | 'subjects'>('classes');
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectTeacherIds, setNewSubjectTeacherIds] = useState<string[]>([]);
  const [assignStudentSearch, setAssignStudentSearch] = useState('');
  // Modal for managing the teachers assigned to a subject
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [editingTeacherIds, setEditingTeacherIds] = useState<string[]>([]);
  const [savingTeachers, setSavingTeachers] = useState(false);

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

  const toggleId = (id: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const onCreateSubject = async () => {
    if (!newSubjectName.trim()) { toast.error('Enter a subject name'); return; }
    setCreatingSubject(true);
    try {
      await adminApi.createSubject({ name: newSubjectName.trim(), teacherIds: newSubjectTeacherIds });
      toast.success('Subject created!');
      setNewSubjectName('');
      setNewSubjectTeacherIds([]);
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

  const openTeacherModal = (s: Subject) => {
    setEditingSubject(s);
    setEditingTeacherIds((s.teachers || []).map(t => t.id));
  };

  const saveTeacherModal = async () => {
    if (!editingSubject) return;
    setSavingTeachers(true);
    try {
      await adminApi.updateSubject(editingSubject.id, { name: editingSubject.name, teacherIds: editingTeacherIds });
      toast.success('Teachers updated');
      setEditingSubject(null);
      loadSubjects();
      // teacher.subject text caches changed too
      adminApi.getTeachers().then(r => setTeachers(r.data || []));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update teachers');
    } finally {
      setSavingTeachers(false);
    }
  };

  return (
    <PageLayout title="Class Management">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('classes')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'classes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Classes
        </button>
        <button
          onClick={() => setActiveTab('subjects')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'subjects' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Subjects
        </button>
      </div>

      {activeTab === 'classes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
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
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Assign Students to Class</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={assignStudentSearch}
                    onChange={e => setAssignStudentSearch(e.target.value)}
                    placeholder="Search students..."
                    className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <Select
                  options={students
                    .filter(s => !assignStudentSearch || s.fullName.toLowerCase().includes(assignStudentSearch.toLowerCase()))
                    .map(s => ({ value: s.id, label: s.fullName }))}
                  placeholder="Select students (assign later)"
                  {...register('assignStudents')}
                />
              </div>
              <Button type="submit" loading={creating} fullWidth icon={<BookOpen className="w-4 h-4" />}>
                Create Class
              </Button>
            </form>
          </Card>

          {/* Existing classes */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-3">
              Existing Classes ({classes.length})
            </h2>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No classes yet</p>
            ) : (
              <div className="space-y-2 max-h-[32rem] overflow-y-auto">
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
            )}
          </Card>
        </div>
      )}

      {activeTab === 'subjects' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Create subject */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-primary-600" />
              <h3 className="font-semibold text-gray-900">Create Subject</h3>
            </div>
            <div className="space-y-3">
              <Input label="Subject Name" placeholder="Subject name (e.g. Mathematics)" value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)} />
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Assign Teachers <span className="text-gray-400 font-normal">(optional, you can pick several)</span></p>
                {teachers.length === 0 ? (
                  <p className="text-xs text-gray-400">No teachers yet</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                    {teachers.map(t => (
                      <label key={t.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                        <input type="checkbox" checked={newSubjectTeacherIds.includes(t.id)} onChange={() => toggleId(t.id, newSubjectTeacherIds, setNewSubjectTeacherIds)} className="w-4 h-4 text-primary-600" />
                        <span className="text-sm text-gray-800">{t.fullName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={onCreateSubject} loading={creatingSubject} fullWidth icon={<Plus className="w-4 h-4" />}>Add Subject</Button>
            </div>
          </Card>

          {/* Subjects list */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">All Subjects ({subjects.length})</h3>
            {subjects.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No subjects yet</p>
            ) : (
              <div className="space-y-2 max-h-[32rem] overflow-y-auto">
                {subjects.map(s => {
                  const names = (s.teachers || []).map(t => t.fullName);
                  return (
                    <div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{s.name}</p>
                        <p className="text-xs text-gray-500 truncate">{names.length ? names.join(', ') : 'No teachers assigned'}</p>
                      </div>
                      <button
                        onClick={() => openTeacherModal(s)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:bg-primary-50 rounded-lg px-2 py-1 whitespace-nowrap"
                      >
                        <Users className="w-3.5 h-3.5" /> {names.length} teacher{names.length === 1 ? '' : 's'}
                      </button>
                      <button onClick={() => onDeleteSubject(s.id)} className="p-1 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal isOpen={!!editingSubject} onClose={() => setEditingSubject(null)} title={editingSubject ? `Teachers for ${editingSubject.name}` : ''}>
        {teachers.length === 0 ? (
          <p className="text-sm text-gray-500">No teachers yet. Add teachers first.</p>
        ) : (
          <div className="space-y-3">
            <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
              {teachers.map(t => (
                <label key={t.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-gray-50 rounded-lg">
                  <input type="checkbox" checked={editingTeacherIds.includes(t.id)} onChange={() => toggleId(t.id, editingTeacherIds, setEditingTeacherIds)} className="w-4 h-4 text-primary-600" />
                  <span className="text-sm text-gray-800">{t.fullName}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setEditingSubject(null)}>Cancel</Button>
              <Button type="button" loading={savingTeachers} onClick={saveTeacherModal}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
