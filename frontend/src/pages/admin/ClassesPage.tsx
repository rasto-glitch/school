import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { BookOpen, Plus, Search, Tag, Trash2, GraduationCap, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import type { Class, Student, Teacher } from '../../types';

interface Subject { id: string; name: string; teachers?: { id: string; fullName: string; classes?: { id: string; name: string }[] }[] }
interface CurriculumRow { id: string; classId: string; className: string | null; subjectId: string; subjectName: string | null; teacherId: string; teacherName: string | null }


export default function ClassesPage() {
  const [activeTab, setActiveTab] = useState<'classes' | 'subjects'>('classes');
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [assignStudentSearch, setAssignStudentSearch] = useState('');
  // Curriculum modal for a class
  const [curriculumClass, setCurriculumClass] = useState<Class | null>(null);
  const [newCstSubjectId, setNewCstSubjectId] = useState('');
  const [newCstTeacherId, setNewCstTeacherId] = useState('');
  const [addingCst, setAddingCst] = useState(false);

  const { register, handleSubmit, reset } = useForm<{ name: string; gradeLevel: string; academicYear: string; assignStudents: string }>();

  const loadClasses = () => adminApi.getClasses().then(r => setClasses(r.data || []));
  const loadSubjects = () => adminApi.getSubjects().then(r => setSubjects(r.data || []));
  const loadCurriculum = () => adminApi.getCurriculum().then(r => setCurriculum(r.data || []));
  const loadTeachers = () => adminApi.getTeachers().then(r => setTeachers(r.data || []));

  useEffect(() => {
    loadClasses();
    loadSubjects();
    loadCurriculum();
    adminApi.getStudents().then(r => setStudents(r.data?.students || []));
    loadTeachers();
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
      await adminApi.createSubject({ name: newSubjectName.trim() });
      toast.success('Subject created!');
      setNewSubjectName('');
      loadSubjects();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create subject');
    } finally {
      setCreatingSubject(false); }
  };

  const onDeleteSubject = async (id: string) => {
    if (!confirm('Delete this subject? It will be removed from every class that uses it.')) return;
    await adminApi.deleteSubject(id).catch(() => {});
    loadSubjects();
    loadCurriculum();
    loadTeachers();
  };

  // ---- Curriculum (per class) ----
  const openCurriculum = (c: Class) => {
    setCurriculumClass(c);
    setNewCstSubjectId('');
    setNewCstTeacherId('');
  };

  const addCstRow = async () => {
    if (!curriculumClass || !newCstSubjectId || !newCstTeacherId) { toast.error('Pick a subject and a teacher'); return; }
    setAddingCst(true);
    try {
      await adminApi.addCurriculumRow({ classId: curriculumClass.id, subjectId: newCstSubjectId, teacherId: newCstTeacherId });
      setNewCstSubjectId('');
      setNewCstTeacherId('');
      await loadCurriculum();
      loadTeachers();
      toast.success('Added');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add');
    } finally {
      setAddingCst(false);
    }
  };

  const removeCstRow = async (rowId: string) => {
    await adminApi.deleteCurriculumRow(rowId).catch(() => {});
    await loadCurriculum();
    loadTeachers();
  };

  const teacherName = (id: string) => teachers.find(t => t.id === id)?.fullName || '—';
  const subjectName = (id: string) => subjects.find(s => s.id === id)?.name || '—';

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
                {classes.map(c => {
                  const rows = curriculum.filter(r => r.classId === c.id);
                  return (
                    <div key={c.id} className="px-4 py-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{c.name}</p>
                          {(c as any).gradeLevel && <p className="text-xs text-gray-400">{(c as any).gradeLevel}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => openCurriculum(c)}
                            className="flex items-center gap-1 text-xs text-primary-600 hover:bg-primary-50 rounded-lg px-2 py-1 whitespace-nowrap"
                          >
                            <GraduationCap className="w-3.5 h-3.5" /> Curriculum ({rows.length})
                          </button>
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
                              if (!confirm(
                                `Delete class "${c.name}"?\n\n` +
                                `Students currently in this class will be unassigned (their records stay).\n\n` +
                                `Grades and attendance for this class will be kept as historical records ` +
                                `(no longer linked to an active class). Homework, assignments, weekly summaries, ` +
                                `and schedule entries for this class will be permanently deleted.`
                              )) return;
                              try {
                                await adminApi.deleteClass(c.id);
                                loadClasses();
                                loadCurriculum();
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
                      {rows.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {rows.map(r => `${r.subjectName} — ${r.teacherName}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  );
                })}
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
              <p className="text-xs text-gray-400">Assign teachers to a subject per class in <span className="font-medium">Classes → Curriculum</span>.</p>
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
                  const summary = (s.teachers || []).map(t => {
                    const cls = (t.classes || []).map(c => c.name).filter(Boolean);
                    return cls.length ? `${t.fullName} (${cls.join(', ')})` : t.fullName;
                  });
                  return (
                    <div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{s.name}</p>
                        <p className="text-xs text-gray-500 truncate">{summary.length ? summary.join('; ') : 'Not assigned to any class yet'}</p>
                      </div>
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

      {/* Curriculum modal */}
      <Modal isOpen={!!curriculumClass} onClose={() => setCurriculumClass(null)} title={curriculumClass ? `Curriculum — ${curriculumClass.name}` : ''} size="lg">
        {curriculumClass && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Which subjects are taught in this class, and by whom.</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {curriculum.filter(r => r.classId === curriculumClass.id).length === 0 ? (
                <p className="text-sm text-gray-400">Nothing assigned yet.</p>
              ) : curriculum.filter(r => r.classId === curriculumClass.id).map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-900 flex-1">{r.subjectName || subjectName(r.subjectId)}</span>
                  <span className="text-sm text-gray-600 flex-1">{r.teacherName || teacherName(r.teacherId)}</span>
                  <button onClick={() => removeCstRow(r.id)} className="p-1 hover:bg-red-50 rounded-lg">
                    <X className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-medium text-gray-700 mb-2">Add</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white" value={newCstSubjectId} onChange={e => setNewCstSubjectId(e.target.value)}>
                  <option value="">Subject…</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white" value={newCstTeacherId} onChange={e => setNewCstTeacherId(e.target.value)}>
                  <option value="">Teacher…</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                </select>
                <Button onClick={addCstRow} loading={addingCst} disabled={!newCstSubjectId || !newCstTeacherId}>Add</Button>
              </div>
              {subjects.length === 0 && <p className="text-xs text-gray-400 mt-2">No subjects yet — create them in the Subjects tab first.</p>}
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
