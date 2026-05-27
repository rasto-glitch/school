import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Search, Paperclip, History, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Student, Class } from '../../types';

interface Parent { id: string; fullName: string; phoneNumber?: string; }

interface ArchivedCandidate {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  departureDate: string;
  reason: string;
  parentFullName: string | null;
  parentPhone: string | null;
}

export default function StudentsManagement() {
  const { t } = useTranslation();
  const archiveEnabled = useAuthStore(s => s.school?.features?.archive === true);
  const [activeTab, setActiveTab] = useState<'active' | 'new'>('active');
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [removeClassId, setRemoveClassId] = useState('');
  const [removeStudentIds, setRemoveStudentIds] = useState<Set<string>>(new Set());
  const [editStudentId, setEditStudentId] = useState('');
  const [editFilterClassId, setEditFilterClassId] = useState('');
  const [archiveFilterClassId, setArchiveFilterClassId] = useState('');
  const [assignCurrentClassId, setAssignCurrentClassId] = useState('');

  const addForm = useForm<{ fullName: string; parentId: string; parentEmail: string; phoneNumber: string; emergencyContact: string; homeAddress: string; classId: string; dateOfBirth: string; residenceType: string; blockNumber: string }>();
  const editForm = useForm<{ fullName: string; parentId: string; phoneNumber: string; emergencyContact: string; homeAddress: string; classId: string; dateOfBirth: string; residenceType: string; blockNumber: string }>();

  // Returning-student search: as the admin types the name, surface archived
  // matches so they can link the new record to a previous enrollment.
  const watchedName = addForm.watch('fullName');
  const watchedDob = addForm.watch('dateOfBirth');
  const debouncedAddName = useDebounce(watchedName ?? '', 350);
  const [archivedMatches, setArchivedMatches] = useState<ArchivedCandidate[]>([]);
  const [linkedArchiveId, setLinkedArchiveId] = useState<string | null>(null);
  const [linkedArchiveLabel, setLinkedArchiveLabel] = useState<string>('');

  const debouncedSearch = useDebounce(search, 400);

  const load = () => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (classFilter) params.classId = classFilter;
    adminApi.getAllStudents(params).then(r => setStudents(r.data?.students || []));
  };

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || []));
    adminApi.getParents().then(r => setParents(r.data || []));
  }, []);
  useEffect(() => { load(); }, [debouncedSearch, classFilter]);

  // Once linked, don't keep searching — the admin already chose a candidate.
  useEffect(() => {
    if (!archiveEnabled || linkedArchiveId) { setArchivedMatches([]); return; }
    const name = (debouncedAddName ?? '').trim();
    if (name.length < 2) { setArchivedMatches([]); return; }
    adminApi.searchArchivedStudents(name, watchedDob || undefined)
      .then(r => setArchivedMatches((r.data ?? []) as ArchivedCandidate[]))
      .catch(() => setArchivedMatches([]));
  }, [debouncedAddName, watchedDob, archiveEnabled, linkedArchiveId]);

  const linkArchiveCandidate = (c: ArchivedCandidate) => {
    addForm.setValue('fullName', c.fullName);
    if (c.dateOfBirth) addForm.setValue('dateOfBirth', c.dateOfBirth);
    setLinkedArchiveId(c.id);
    setLinkedArchiveLabel(`${c.fullName} · departed ${c.departureDate}`);
    setArchivedMatches([]);
  };
  const clearArchiveLink = () => {
    setLinkedArchiveId(null);
    setLinkedArchiveLabel('');
  };

  useEffect(() => {
    if (!editStudentId) return;
    const s = students.find(s => s.id === editStudentId);
    if (!s) return;
    editForm.setValue('fullName', s.fullName);
    editForm.setValue('phoneNumber', s.phoneNumber || '');
    editForm.setValue('emergencyContact', s.emergencyContact || '');
    editForm.setValue('homeAddress', s.homeAddress || '');
    editForm.setValue('classId', s.classId || '');
    editForm.setValue('parentId', s.parentId || '');
    editForm.setValue('residenceType', (s as any).parents?.residenceType || '');
    editForm.setValue('blockNumber', (s as any).parents?.blockNumber || '');
  }, [editStudentId, students]);

  const filteredByRemoveClass = removeClassId ? students.filter(s => s.classId === removeClassId) : students;
  const filteredByAssignClass = assignCurrentClassId ? students.filter(s => s.classId === assignCurrentClassId) : students;

  const onAdd = async (data: any) => {
    setAddSubmitting(true);
    try {
      const res = await adminApi.createStudent({
        fullName: data.fullName,
        parentId: data.parentId || undefined,
        parentEmail: data.parentEmail || undefined,
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        homeAddress: data.homeAddress,
        classId: data.classId || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
        residenceType: data.residenceType || undefined,
        blockNumber: data.blockNumber || undefined,
        previousArchiveId: linkedArchiveId || undefined,
      });
      if (data.parentId && (data.residenceType || data.blockNumber)) {
        await adminApi.updateParent(data.parentId, { residenceType: data.residenceType || null, blockNumber: data.blockNumber || null }).catch(() => {});
      }
      const created = res.data?.parentAccountCreated;
      if (created) {
        toast.success(t('admin.students_mgmt.student_added_parent', { username: created.username }), { autoClose: 8000 });
        adminApi.getParents().then(r => setParents(r.data || []));
      } else {
        toast.success(t('admin.students_mgmt.student_added'));
      }
      addForm.reset();
      clearArchiveLink();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.failed_add'));
    } finally { setAddSubmitting(false); }
  };

  const onEdit = async (data: any) => {
    if (!editStudentId) return;
    setEditSubmitting(true);
    try {
      await adminApi.updateStudent(editStudentId, { fullName: data.fullName, parentId: data.parentId || undefined, phoneNumber: data.phoneNumber, emergencyContact: data.emergencyContact, homeAddress: data.homeAddress, classId: data.classId || undefined, dateOfBirth: data.dateOfBirth || undefined });
      if (data.parentId && (data.residenceType !== undefined || data.blockNumber !== undefined)) {
        await adminApi.updateParent(data.parentId, { residenceType: data.residenceType || null, blockNumber: data.blockNumber || null }).catch(() => {});
      }
      toast.success(t('admin.students_mgmt.student_updated'));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.failed'));
    } finally { setEditSubmitting(false); }
  };

  const toggleRemoveStudent = (id: string) => {
    setRemoveStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onRemove = async () => {
    if (removeStudentIds.size === 0) { toast.error(t('admin.students_mgmt.select_one_remove')); return; }
    const count = removeStudentIds.size;
    if (!confirm(t('admin.students_mgmt.confirm_remove', { count }))) return;
    setRemoveSubmitting(true);
    try {
      await Promise.all([...removeStudentIds].map(id => adminApi.deleteStudent(id)));
      toast.success(t('admin.students_mgmt.removed_count', { count }));
      setRemoveStudentIds(new Set());
      setRemoveClassId('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.failed_remove'));
    } finally { setRemoveSubmitting(false); }
  };

  const [excludedStudentIds, setExcludedStudentIds] = useState<Set<string>>(new Set());
  const [bulkNewClassId, setBulkNewClassId] = useState('');
  const [bulkGraduated, setBulkGraduated] = useState(false);

  const [archiveStudentId, setArchiveStudentId] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveDepartureDate, setArchiveDepartureDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  const onArchive = async () => {
    if (!archiveStudentId) { toast.error(t('admin.students_mgmt.select_student_archive')); return; }
    if (!archiveReason) { toast.error(t('admin.students_mgmt.select_reason')); return; }
    const student = students.find(s => s.id === archiveStudentId);
    if (!confirm(t('admin.students_mgmt.confirm_archive', { name: student?.fullName }))) return;
    setArchiveSubmitting(true);
    try {
      await adminApi.archiveStudent(archiveStudentId, { reason: archiveReason, departureDate: archiveDepartureDate });
      toast.success(t('admin.students_mgmt.archived_done', { name: student?.fullName }));
      setArchiveStudentId('');
      setArchiveReason('');
      setArchiveDepartureDate(new Date().toISOString().split('T')[0]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.failed_archive'));
    } finally { setArchiveSubmitting(false); }
  };

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; skipped: number; total: number; autoCreatedClasses: string[]; parentAccountsCreated: number; errors: string[] } | null>(null);

  const onAssign = async (_data: any) => {
    // Bulk assign: all students in selected class, excluding those in excludedStudentIds
    const studentsToAssign = filteredByAssignClass.filter(s => !excludedStudentIds.has(s.id));
    if (studentsToAssign.length === 0) { toast.error(t('admin.students_mgmt.no_students_assign')); return; }
    setAssignSubmitting(true);
    try {
      await Promise.all(studentsToAssign.map(s =>
        adminApi.assignStudent({ studentId: s.id, newClassId: bulkNewClassId || undefined, graduated: bulkGraduated })
      ));
      toast.success(t('admin.students_mgmt.assigned_done', { count: studentsToAssign.length }));
      setExcludedStudentIds(new Set());
      setBulkNewClassId('');
      setBulkGraduated(false);
      setAssignCurrentClassId('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.failed'));
    } finally { setAssignSubmitting(false); }
  };

  const onBulkUpload = async () => {
    if (!uploadFile) { toast.error(t('admin.students_mgmt.select_excel_first')); return; }
    setUploadLoading(true);
    setUploadResult(null);
    try {
      const res = await adminApi.bulkUploadStudents(uploadFile);
      const result = res.data;
      setUploadResult(result);
      if (result.created > 0) {
        toast.success(result.skipped > 0
          ? t('admin.students_mgmt.upload_added_skipped', { created: result.created, skipped: result.skipped })
          : t('admin.students_mgmt.upload_added', { created: result.created }));
        load();
        adminApi.getClasses().then(r => setClasses(r.data || []));
        adminApi.getParents().then(r => setParents(r.data || []));
      } else if (result.skipped > 0) {
        toast.info(t('admin.students_mgmt.upload_all_exist', { count: result.skipped }));
      } else {
        toast.error(t('admin.students_mgmt.upload_none_created'));
      }
      setUploadFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.students_mgmt.upload_failed'));
    } finally {
      setUploadLoading(false);
    }
  };


  return (
    <PageLayout title={t('admin.students_mgmt.title')}>
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t('admin.students_mgmt.tab_active')}
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t('admin.students_mgmt.tab_new')}
        </button>
      </div>

      {activeTab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="font-bold text-gray-900 mb-4 text-center">{t('admin.students_mgmt.add_student')}</h2>
            <form onSubmit={addForm.handleSubmit(onAdd)} className="space-y-3">
              <Input placeholder={t('admin.students_mgmt.full_name')} {...addForm.register('fullName', { required: true })} />
              {linkedArchiveId ? (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <History className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-amber-900">{t('admin.students_mgmt.linking_previous')}</div>
                    <div className="text-amber-800 truncate">{linkedArchiveLabel}</div>
                  </div>
                  <button type="button" onClick={clearArchiveLink} className="p-1 text-amber-700 hover:bg-amber-100 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : archivedMatches.length > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-amber-900 font-medium mb-2">
                    <History className="w-4 h-4" /> {t('admin.students_mgmt.archived_matches', { count: archivedMatches.length })}
                  </div>
                  <div className="space-y-1.5">
                    {archivedMatches.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => linkArchiveCandidate(c)}
                        className="w-full text-left bg-white hover:bg-amber-100 border border-amber-200 rounded px-3 py-2 text-sm"
                      >
                        <div className="font-medium text-gray-900">{c.fullName}</div>
                        <div className="text-xs text-gray-600">
                          {c.dateOfBirth && <>{t('admin.students_mgmt.dob')} {c.dateOfBirth} · </>}
                          {t('admin.students_mgmt.match_reason_on', { reason: c.reason, date: c.departureDate })}
                          {c.parentFullName && <> · {t('admin.students_mgmt.match_parent', { name: c.parentFullName })}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-amber-700 mt-2">{t('admin.students_mgmt.click_match_hint')}</div>
                </div>
              ) : null}
              <Select options={parents.map(p => ({ value: p.id, label: p.fullName }))} placeholder={t('admin.students_mgmt.select_parent')} {...addForm.register('parentId')} />
              <Input placeholder={t('admin.students_mgmt.parent_email')} type="email" {...addForm.register('parentEmail')} />
              <Input placeholder={t('admin.students_mgmt.primary_phone')} {...addForm.register('phoneNumber')} />
              <Input placeholder={t('admin.students_mgmt.emergency_contact')} {...addForm.register('emergencyContact')} />
              <Input placeholder={t('admin.students_mgmt.address')} {...addForm.register('homeAddress')} />
              <Select
                options={[{ value: 'house', label: t('admin.students_mgmt.house') }, { value: 'apartment', label: t('admin.students_mgmt.apartment') }]}
                placeholder={t('admin.students_mgmt.residence_type')}
                {...addForm.register('residenceType')}
              />
              <Input placeholder={t('admin.students_mgmt.block_number')} {...addForm.register('blockNumber')} />
              <Input label={t('admin.students_mgmt.date_of_birth')} type="date" {...addForm.register('dateOfBirth')} />
              <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('admin.students_mgmt.select_class')} {...addForm.register('classId')} />
              <Button type="submit" loading={addSubmitting} fullWidth>{t('admin.students_mgmt.send')}</Button>
            </form>
          </Card>

          <Card>
            <h2 className="font-bold text-gray-900 mb-3 text-center">{t('admin.students_mgmt.upload_students')}</h2>
            <p className="text-xs text-gray-500 mb-1">{t('admin.students_mgmt.excel_columns')} <span className="font-medium text-gray-700">{t('admin.students_mgmt.excel_columns_list')}</span></p>
            <p className="text-xs text-gray-400 mb-3">{t('admin.students_mgmt.upload_hint')}</p>
            <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 rounded-xl p-3 hover:border-primary-400 transition-colors">
              <Paperclip className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-500 truncate">{uploadFile ? uploadFile.name : t('admin.students_mgmt.choose_file')}</span>
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={e => { setUploadFile(e.target.files?.[0] || null); setUploadResult(null); }}
              />
            </label>
            <Button className="mt-3" fullWidth loading={uploadLoading} onClick={onBulkUpload}>{t('admin.students_mgmt.upload')}</Button>
            {uploadResult && (
              <div className="mt-3 text-sm space-y-1">
                <p className="text-green-700 font-medium">{t('admin.students_mgmt.upload_summary', { created: uploadResult.created, skipped: uploadResult.skipped, total: uploadResult.total })}</p>
                {uploadResult.parentAccountsCreated > 0 && (
                  <p className="text-green-600 text-xs">{t('admin.students_mgmt.parent_accounts_created', { count: uploadResult.parentAccountsCreated })} <span className="font-mono font-semibold">Parent@123</span></p>
                )}
                {uploadResult.autoCreatedClasses.length > 0 && (
                  <p className="text-blue-600 text-xs">{t('admin.students_mgmt.auto_created_classes', { list: uploadResult.autoCreatedClasses.join(', ') })}</p>
                )}
                {uploadResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 max-h-32 overflow-y-auto">
                    {uploadResult.errors.map((e, i) => (
                      <p key={i} className="text-red-600 text-xs">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'active' && <div className="space-y-8">
        {/* Search bar */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder={t('admin.students_mgmt.search_ph')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="w-48">
              <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('admin.students_mgmt.all_classes')} value={classFilter} onChange={e => setClassFilter(e.target.value)} />
            </div>
          </div>
          {/* Search results — click to load into Edit Student form */}
          {debouncedSearch && students.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('admin.students_mgmt.found_click_edit', { count: students.length })}</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
                {students.slice(0, 8).map(s => (
                  <button
                    key={s.id}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                    onClick={() => {
                      setEditStudentId(s.id);
                      setSearch('');
                      // Scroll to edit section
                      document.getElementById('edit-student-section')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    <div className="w-7 h-7 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-xs">{s.fullName?.[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.fullName}</p>
                      <p className="text-xs text-gray-500">
                        {(s as any).classes?.name || t('admin.students_mgmt.no_class')}
                        {(s as any).parents?.residenceType && (
                          <span className="ml-2 text-gray-400">
                            · {(s as any).parents.residenceType === 'apartment' ? t('admin.students_mgmt.apt') : t('admin.students_mgmt.house_short')}
                            {(s as any).parents.blockNumber ? ` ${(s as any).parents.blockNumber}` : ''}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Remove + Archive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
              <h2 className="font-bold text-gray-900 mb-4 text-center">{t('admin.students_mgmt.remove_students')}</h2>
              <div className="space-y-3">
                <Select
                  options={classes.map(c => ({ value: c.id, label: c.name }))}
                  placeholder={t('admin.students_mgmt.filter_by_class')}
                  value={removeClassId}
                  onChange={e => { setRemoveClassId(e.target.value); setRemoveStudentIds(new Set()); }}
                />
                {/* Multi-select checkbox list */}
                {filteredByRemoveClass.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {removeStudentIds.size > 0
                          ? t('admin.students_mgmt.selected_count', { count: removeStudentIds.size })
                          : t('admin.students_mgmt.select_to_remove')}
                      </span>
                      <button
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                        onClick={() => {
                          if (removeStudentIds.size === filteredByRemoveClass.length) {
                            setRemoveStudentIds(new Set());
                          } else {
                            setRemoveStudentIds(new Set(filteredByRemoveClass.map(s => s.id)));
                          }
                        }}
                      >
                        {removeStudentIds.size === filteredByRemoveClass.length ? t('admin.students_mgmt.deselect_all') : t('admin.students_mgmt.select_all')}
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
                      {filteredByRemoveClass.map(s => (
                        <label
                          key={s.id}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${removeStudentIds.has(s.id) ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={removeStudentIds.has(s.id)}
                            onChange={() => toggleRemoveStudent(s.id)}
                            className="w-4 h-4 text-red-500 rounded"
                          />
                          <div className="min-w-0">
                            <p className={`text-sm font-medium truncate ${removeStudentIds.has(s.id) ? 'text-red-700 line-through' : 'text-gray-900'}`}>
                              {s.fullName}
                            </p>
                            <p className="text-xs text-gray-400">{(s as any).classes?.name || t('admin.students_mgmt.no_class')}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <Button
                      variant="danger"
                      loading={removeSubmitting}
                      fullWidth
                      onClick={onRemove}
                      disabled={removeStudentIds.size === 0}
                    >
                      {removeStudentIds.size > 0
                        ? t('admin.students_mgmt.remove_n', { count: removeStudentIds.size })
                        : t('admin.students_mgmt.remove')}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {removeClassId ? t('admin.students_mgmt.no_students_class') : t('admin.students_mgmt.select_class_or_all')}
                  </p>
                )}
              </div>
            </Card>

            {archiveEnabled && (
              <Card>
                <h2 className="font-bold text-gray-900 mb-4 text-center">{t('admin.students_mgmt.archive_student')}</h2>
                <p className="text-xs text-gray-400 mb-3 text-center">{t('admin.students_mgmt.archive_desc')}</p>
                <div className="space-y-3">
                  <Select
                    options={classes.map(c => ({ value: c.id, label: c.name }))}
                    placeholder={t('admin.students_mgmt.filter_by_class')}
                    value={archiveFilterClassId}
                    onChange={e => { setArchiveFilterClassId(e.target.value); setArchiveStudentId(''); }}
                  />
                  <Select
                    options={(archiveFilterClassId ? students.filter(s => s.classId === archiveFilterClassId) : students).map(s => ({ value: s.id, label: s.fullName }))}
                    placeholder={t('admin.students_mgmt.select_student')}
                    value={archiveStudentId}
                    onChange={e => setArchiveStudentId(e.target.value)}
                  />
                  <Select
                    options={[
                      { value: 'transferred', label: t('admin.students_mgmt.reason_transferred') },
                      { value: 'withdrew', label: t('admin.students_mgmt.reason_withdrew') },
                    ]}
                    placeholder={t('admin.students_mgmt.reason_leaving')}
                    value={archiveReason}
                    onChange={e => setArchiveReason(e.target.value)}
                  />
                  <Input
                    label={t('admin.students_mgmt.departure_date')}
                    type="date"
                    value={archiveDepartureDate}
                    onChange={e => setArchiveDepartureDate(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={archiveSubmitting}
                    disabled={!archiveStudentId || !archiveReason}
                    onClick={onArchive}
                  >
                    {t('admin.students_mgmt.archive_student')}
                  </Button>
                </div>
              </Card>
            )}
        </div>

        {/* Edit Student */}
        <Card className="max-w-xl" id="edit-student-section" style={{ scrollMarginTop: '80px' } as React.CSSProperties}>
          <h2 className="font-bold text-gray-900 mb-4 text-center">{t('admin.students_mgmt.edit_student')}</h2>
          <div className="space-y-3">
            <Select
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder={t('admin.students_mgmt.filter_by_class')}
              value={editFilterClassId}
              onChange={e => { setEditFilterClassId(e.target.value); setEditStudentId(''); }}
            />
            <Select
              options={(editFilterClassId ? students.filter(s => s.classId === editFilterClassId) : students).map(s => ({ value: s.id, label: s.fullName }))}
              placeholder={t('admin.students_mgmt.select_student')}
              value={editStudentId}
              onChange={e => setEditStudentId(e.target.value)}
            />
            {editStudentId && (
              <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3 pt-2">
                <Input placeholder={t('admin.students_mgmt.full_name')} {...editForm.register('fullName')} />
                <Select options={parents.map(p => ({ value: p.id, label: p.fullName }))} placeholder={t('admin.students_mgmt.select_parent')} {...editForm.register('parentId')} />
                <Input placeholder={t('admin.students_mgmt.primary_phone')} {...editForm.register('phoneNumber')} />
                <Input placeholder={t('admin.students_mgmt.emergency_contact')} {...editForm.register('emergencyContact')} />
                <Input placeholder={t('admin.students_mgmt.address')} {...editForm.register('homeAddress')} />
                <Select
                  options={[{ value: 'house', label: t('admin.students_mgmt.house') }, { value: 'apartment', label: t('admin.students_mgmt.apartment') }]}
                  placeholder={t('admin.students_mgmt.residence_type')}
                  {...editForm.register('residenceType')}
                />
                <Input placeholder={t('admin.students_mgmt.block_number')} {...editForm.register('blockNumber')} />
                <Input label={t('admin.students_mgmt.date_of_birth')} type="date" {...editForm.register('dateOfBirth')} />
                <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('admin.students_mgmt.select_class')} {...editForm.register('classId')} />
                <Button type="submit" loading={editSubmitting} fullWidth>{t('admin.students_mgmt.send')}</Button>
              </form>
            )}
          </div>
        </Card>

        {/* Assign Students (Bulk) */}
        <Card className="max-w-2xl">
          <h2 className="font-bold text-gray-900 mb-1 text-center">{t('admin.students_mgmt.assign_students')}</h2>
          <p className="text-xs text-gray-500 text-center mb-4">{t('admin.students_mgmt.assign_desc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">{t('admin.students_mgmt.current_class')}</p>
              <Select
                options={classes.map(c => ({ value: c.id, label: c.name }))}
                placeholder={t('admin.students_mgmt.select_class')}
                value={assignCurrentClassId}
                onChange={e => { setAssignCurrentClassId(e.target.value); setExcludedStudentIds(new Set()); }}
              />
              {filteredByAssignClass.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">{t('admin.students_mgmt.uncheck_exclude')}</p>
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                    {filteredByAssignClass.map(s => (
                      <label key={s.id} className={`flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg ${excludedStudentIds.has(s.id) ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!excludedStudentIds.has(s.id)}
                          onChange={() => {
                            const next = new Set(excludedStudentIds);
                            if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                            setExcludedStudentIds(next);
                          }}
                          className="w-4 h-4 text-primary-600"
                        />
                        <span className={`text-sm ${excludedStudentIds.has(s.id) ? 'line-through text-gray-400' : 'text-gray-800'}`}>{s.fullName}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('admin.students_mgmt.will_be_assigned', { count: filteredByAssignClass.length - excludedStudentIds.size, total: filteredByAssignClass.length })}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">{t('admin.students_mgmt.new_class')}</p>
              <Select
                options={classes.map(c => ({ value: c.id, label: c.name }))}
                placeholder={t('admin.students_mgmt.select_class')}
                value={bulkNewClassId}
                onChange={e => setBulkNewClassId(e.target.value)}
              />
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input type="checkbox" checked={bulkGraduated} onChange={e => setBulkGraduated(e.target.checked)} className="w-4 h-4 text-primary-600" />
                <span className="text-sm text-gray-700">{t('admin.students_mgmt.mark_graduated')}</span>
              </label>
            </div>
          </div>
          <Button
            loading={assignSubmitting}
            fullWidth
            disabled={!assignCurrentClassId || filteredByAssignClass.length === excludedStudentIds.size}
            onClick={() => onAssign({})}
          >
            {t('admin.students_mgmt.assign_n', { count: filteredByAssignClass.length - excludedStudentIds.size })}
          </Button>
        </Card>
      </div>}
    </PageLayout>
  );
}
