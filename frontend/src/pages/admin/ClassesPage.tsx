import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation, Trans } from 'react-i18next';
import { toast } from 'react-toastify';
import { BookOpen, Plus, Search, Tag, Trash2, GraduationCap, X, Rocket, Database } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import PromoteClassModal from '../../components/admin/PromoteClassModal';
import EnrollmentBackfillModal from '../../components/admin/EnrollmentBackfillModal';
import type { Class, Student, Teacher } from '../../types';

interface Subject { id: string; name: string; teachers?: { id: string; fullName: string; classes?: { id: string; name: string }[] }[] }
interface CurriculumRow { id: string; classId: string; className: string | null; subjectId: string; subjectName: string | null; teacherId: string; teacherName: string | null }


export default function ClassesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: 'classes' | 'subjects' = rawTab === 'subjects' ? 'subjects' : 'classes';
  const setActiveTab = (tab: 'classes' | 'subjects') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
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
  // Year-end promote wizard (migration 030)
  const [promoteClassId, setPromoteClassId] = useState<string | null>(null);
  // One-off enrollment-history backfill (migration 030)
  const [backfillOpen, setBackfillOpen] = useState(false);

  const { register, handleSubmit, reset } = useForm<{ name: string; gradeLevel: string; academicYear: string; assignStudents: string }>();

  const loadClasses = () => adminApi.getClasses().then(r => setClasses(r.data || []));
  const loadSubjects = () => adminApi.getSubjects().then(r => setSubjects(r.data || []));
  const loadCurriculum = () => adminApi.getCurriculum().then(r => setCurriculum(r.data || []));
  const loadTeachers = () => adminApi.getTeachers().then(r => setTeachers(r.data || []));

  useEffect(() => {
    loadClasses();
    loadSubjects();
    loadCurriculum();
    adminApi.getAllStudents().then(r => setStudents(r.data?.students || []));
    loadTeachers();
  }, []);

  const onCreate = async (data: any) => {
    setCreating(true);
    try {
      await adminApi.createClass(data);
      toast.success(t('admin.cls.class_created'));
      reset();
      loadClasses();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.cls.failed_create_class'));
    } finally {
      setCreating(false);
    }
  };

  const onCreateSubject = async () => {
    if (!newSubjectName.trim()) { toast.error(t('admin.cls.enter_subject_name')); return; }
    setCreatingSubject(true);
    try {
      await adminApi.createSubject({ name: newSubjectName.trim() });
      toast.success(t('admin.cls.subject_created'));
      setNewSubjectName('');
      loadSubjects();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.cls.failed_create_subject'));
    } finally {
      setCreatingSubject(false); }
  };

  const onDeleteSubject = async (id: string) => {
    if (!confirm(t('admin.cls.confirm_delete_subject'))) return;
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
    if (!curriculumClass || !newCstSubjectId || !newCstTeacherId) { toast.error(t('admin.cls.pick_subject_teacher')); return; }
    setAddingCst(true);
    try {
      await adminApi.addCurriculumRow({ classId: curriculumClass.id, subjectId: newCstSubjectId, teacherId: newCstTeacherId });
      setNewCstSubjectId('');
      setNewCstTeacherId('');
      await loadCurriculum();
      loadTeachers();
      toast.success(t('admin.cls.added'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.cls.failed_add'));
    } finally {
      setAddingCst(false);
    }
  };

  const removeCstRow = async (rowId: string) => {
    await adminApi.deleteCurriculumRow(rowId).catch(() => {});
    await loadCurriculum();
    loadTeachers();
  };

  const teacherName = (id: string) => teachers.find(tc => tc.id === id)?.fullName || '—';
  const subjectName = (id: string) => subjects.find(s => s.id === id)?.name || '—';

  return (
    <PageLayout title={t('admin.cls.title')}>
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('classes')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'classes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t('admin.cls.tab_classes')}
        </button>
        <button
          onClick={() => setActiveTab('subjects')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'subjects' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t('admin.cls.tab_subjects')}
        </button>
      </div>

      {activeTab === 'classes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Create Class */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-5 h-5 text-primary-600" />
              <h2 className="font-semibold text-gray-900">{t('admin.cls.create_class')}</h2>
            </div>
            <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
              <Input label={t('admin.cls.class_name')} placeholder={t('admin.cls.class_name_ph')} {...register('name', { required: true })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('admin.cls.grade_level')} placeholder={t('admin.cls.grade_level_ph')} {...register('gradeLevel')} />
                <Input label={t('admin.cls.academic_year')} placeholder={t('admin.cls.academic_year_ph')} {...register('academicYear')} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">{t('admin.cls.assign_students')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={assignStudentSearch}
                    onChange={e => setAssignStudentSearch(e.target.value)}
                    placeholder={t('admin.cls.search_students')}
                    className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <Select
                  options={students
                    .filter(s => !assignStudentSearch || s.fullName.toLowerCase().includes(assignStudentSearch.toLowerCase()))
                    .map(s => ({ value: s.id, label: s.fullName }))}
                  placeholder={t('admin.cls.select_students')}
                  {...register('assignStudents')}
                />
              </div>
              <Button type="submit" loading={creating} fullWidth icon={<BookOpen className="w-4 h-4" />}>
                {t('admin.cls.create_class')}
              </Button>
            </form>
          </Card>

          {/* Existing classes */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">
                {t('admin.cls.existing_classes', { count: classes.length })}
              </h2>
              <button
                onClick={() => setBackfillOpen(true)}
                title={t('admin.bf.tooltip', 'Reconstruct per-year enrollment history for existing students')}
                className="flex items-center gap-1 text-xs text-sky-700 hover:bg-sky-50 rounded-lg px-2 py-1 whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5" /> {t('admin.bf.button', 'Backfill history')}
              </button>
            </div>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">{t('admin.cls.no_classes')}</p>
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
                            <GraduationCap className="w-3.5 h-3.5" /> {t('admin.cls.curriculum_count', { count: rows.length })}
                          </button>
                          <button
                            onClick={() => setPromoteClassId(c.id)}
                            title={t('admin.promote.button_title', 'Run year-end promotion for this class')}
                            className="flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1 whitespace-nowrap"
                          >
                            <Rocket className="w-3.5 h-3.5" /> {t('admin.promote.button', 'Promote')}
                          </button>
                          <span className="text-xs text-gray-400 whitespace-nowrap">{t('admin.cls.next_class')}</span>
                          <select
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            value={(c as any).nextClassId || ''}
                            onChange={async e => {
                              const nextClassId = e.target.value || null;
                              try {
                                await adminApi.updateClass(c.id, { nextClassId });
                                loadClasses();
                              } catch {
                                toast.error(t('admin.cls.failed_update_next'));
                              }
                            }}
                          >
                            <option value="">{t('admin.cls.none_graduating')}</option>
                            {classes.filter(oc => oc.id !== c.id).map(oc => (
                              <option key={oc.id} value={oc.id}>{oc.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={async () => {
                              if (!confirm(t('admin.cls.confirm_delete_class', { name: c.name }))) return;
                              try {
                                await adminApi.deleteClass(c.id);
                                loadClasses();
                                loadCurriculum();
                                toast.success(t('admin.cls.class_deleted'));
                              } catch {
                                toast.error(t('admin.cls.failed_delete_class'));
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
              <h3 className="font-semibold text-gray-900">{t('admin.cls.create_subject')}</h3>
            </div>
            <div className="space-y-3">
              <Input label={t('admin.cls.subject_name')} placeholder={t('admin.cls.subject_name_ph')} value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)} />
              <p className="text-xs text-gray-400"><Trans i18nKey="admin.cls.assign_teachers_hint" components={{ b: <span className="font-medium" /> }} /></p>
              <Button onClick={onCreateSubject} loading={creatingSubject} fullWidth icon={<Plus className="w-4 h-4" />}>{t('admin.cls.add_subject')}</Button>
            </div>
          </Card>

          {/* Subjects list */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">{t('admin.cls.all_subjects', { count: subjects.length })}</h3>
            {subjects.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">{t('admin.cls.no_subjects')}</p>
            ) : (
              <div className="space-y-2 max-h-[32rem] overflow-y-auto">
                {subjects.map(s => {
                  const summary = (s.teachers || []).map(tch => {
                    const cls = (tch.classes || []).map(c => c.name).filter(Boolean);
                    return cls.length ? `${tch.fullName} (${cls.join(', ')})` : tch.fullName;
                  });
                  return (
                    <div key={s.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{s.name}</p>
                        <p className="text-xs text-gray-500 truncate">{summary.length ? summary.join('; ') : t('admin.cls.not_assigned')}</p>
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
      <Modal isOpen={!!curriculumClass} onClose={() => setCurriculumClass(null)} title={curriculumClass ? t('admin.cls.curriculum_title', { name: curriculumClass.name }) : ''} size="lg">
        {curriculumClass && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t('admin.cls.curriculum_hint')}</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {curriculum.filter(r => r.classId === curriculumClass.id).length === 0 ? (
                <p className="text-sm text-gray-400">{t('admin.cls.nothing_assigned')}</p>
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
              <p className="text-sm font-medium text-gray-700 mb-2">{t('admin.cls.add')}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white" value={newCstSubjectId} onChange={e => setNewCstSubjectId(e.target.value)}>
                  <option value="">{t('admin.cls.subject_opt')}</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white" value={newCstTeacherId} onChange={e => setNewCstTeacherId(e.target.value)}>
                  <option value="">{t('admin.cls.teacher_opt')}</option>
                  {teachers
                    .filter(tc => (tc.teacherClasses || []).some(c => c.classId === curriculumClass.id))
                    .map(tc => <option key={tc.id} value={tc.id}>{tc.fullName}</option>)}
                </select>
                <Button onClick={addCstRow} loading={addingCst} disabled={!newCstSubjectId || !newCstTeacherId}>{t('admin.cls.add')}</Button>
              </div>
              {subjects.length === 0 && <p className="text-xs text-gray-400 mt-2">{t('admin.cls.no_subjects_hint')}</p>}
              {teachers.filter(tc => (tc.teacherClasses || []).some(c => c.classId === curriculumClass.id)).length === 0 && (
                <p className="text-xs text-gray-400 mt-2"><Trans i18nKey="admin.cls.no_teachers_hint" components={{ b: <span className="font-medium" /> }} /></p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Year-end Promote Class wizard (migration 030) */}
      <PromoteClassModal
        isOpen={!!promoteClassId}
        onClose={() => setPromoteClassId(null)}
        sourceClassId={promoteClassId}
        allClasses={classes.map(c => ({ id: c.id, name: c.name, gradeLevel: (c as any).gradeLevel ?? null }))}
        onCompleted={loadClasses}
      />

      {/* Enrollment-history backfill (migration 030) */}
      <EnrollmentBackfillModal
        isOpen={backfillOpen}
        onClose={() => setBackfillOpen(false)}
      />
    </PageLayout>
  );
}
