import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Search, Paperclip } from 'lucide-react';
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

export default function StudentsManagement() {
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

  const addForm = useForm<{ fullName: string; parentId: string; phoneNumber: string; emergencyContact: string; homeAddress: string; classId: string; dateOfBirth: string; residenceType: string; blockNumber: string }>();
  const editForm = useForm<{ fullName: string; parentId: string; phoneNumber: string; emergencyContact: string; homeAddress: string; classId: string; dateOfBirth: string; residenceType: string; blockNumber: string }>();

  const debouncedSearch = useDebounce(search, 400);

  const load = () => {
    const params: Record<string, string> = { limit: '1000' };
    if (debouncedSearch) params.search = debouncedSearch;
    if (classFilter) params.classId = classFilter;
    adminApi.getStudents(params).then(r => setStudents(r.data?.students || []));
  };

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || []));
    adminApi.getParents().then(r => setParents(r.data || []));
  }, []);
  useEffect(() => { load(); }, [debouncedSearch, classFilter]);

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
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        homeAddress: data.homeAddress,
        classId: data.classId || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
        residenceType: data.residenceType || undefined,
        blockNumber: data.blockNumber || undefined,
      });
      if (data.parentId && (data.residenceType || data.blockNumber)) {
        await adminApi.updateParent(data.parentId, { residenceType: data.residenceType || null, blockNumber: data.blockNumber || null }).catch(() => {});
      }
      const created = res.data?.parentAccountCreated;
      if (created) {
        toast.success(`Student added! Parent account created — username: ${created.username} · password: Parent@123`, { autoClose: 8000 });
        adminApi.getParents().then(r => setParents(r.data || []));
      } else {
        toast.success('Student added!');
      }
      addForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add student');
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
      toast.success('Student updated!');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
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
    if (removeStudentIds.size === 0) { toast.error('Select at least one student to remove'); return; }
    const count = removeStudentIds.size;
    if (!confirm(`Remove ${count} student${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setRemoveSubmitting(true);
    try {
      await Promise.all([...removeStudentIds].map(id => adminApi.deleteStudent(id)));
      toast.success(`${count} student${count > 1 ? 's' : ''} removed`);
      setRemoveStudentIds(new Set());
      setRemoveClassId('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove students');
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
    if (!archiveStudentId) { toast.error('Select a student to archive'); return; }
    if (!archiveReason) { toast.error('Select a reason'); return; }
    const student = students.find(s => s.id === archiveStudentId);
    if (!confirm(`Archive "${student?.fullName}"? Their grades and parent info will be saved, and they will be removed from active students.`)) return;
    setArchiveSubmitting(true);
    try {
      await adminApi.archiveStudent(archiveStudentId, { reason: archiveReason, departureDate: archiveDepartureDate });
      toast.success(`${student?.fullName} has been archived`);
      setArchiveStudentId('');
      setArchiveReason('');
      setArchiveDepartureDate(new Date().toISOString().split('T')[0]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to archive student');
    } finally { setArchiveSubmitting(false); }
  };

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; skipped: number; total: number; autoCreatedClasses: string[]; parentAccountsCreated: number; errors: string[] } | null>(null);

  const onAssign = async (_data: any) => {
    // Bulk assign: all students in selected class, excluding those in excludedStudentIds
    const studentsToAssign = filteredByAssignClass.filter(s => !excludedStudentIds.has(s.id));
    if (studentsToAssign.length === 0) { toast.error('No students to assign'); return; }
    setAssignSubmitting(true);
    try {
      await Promise.all(studentsToAssign.map(s =>
        adminApi.assignStudent({ studentId: s.id, newClassId: bulkNewClassId || undefined, graduated: bulkGraduated })
      ));
      toast.success(`${studentsToAssign.length} students assigned!`);
      setExcludedStudentIds(new Set());
      setBulkNewClassId('');
      setBulkGraduated(false);
      setAssignCurrentClassId('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setAssignSubmitting(false); }
  };

  const onBulkUpload = async () => {
    if (!uploadFile) { toast.error('Please select an Excel file first'); return; }
    setUploadLoading(true);
    setUploadResult(null);
    try {
      const res = await adminApi.bulkUploadStudents(uploadFile);
      const result = res.data;
      setUploadResult(result);
      if (result.created > 0) {
        toast.success(`${result.created} student${result.created !== 1 ? 's' : ''} added${result.skipped > 0 ? `, ${result.skipped} already existed` : ''}`);
        load();
        adminApi.getClasses().then(r => setClasses(r.data || []));
        adminApi.getParents().then(r => setParents(r.data || []));
      } else if (result.skipped > 0) {
        toast.info(`All ${result.skipped} students already exist — nothing added.`);
      } else {
        toast.error('No students were created. Check the errors below.');
      }
      setUploadFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };


  return (
    <PageLayout title="Students Management">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Active Students
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          New Student
        </button>
      </div>

      {activeTab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="font-bold text-gray-900 mb-4 text-center">Add Student</h2>
            <form onSubmit={addForm.handleSubmit(onAdd)} className="space-y-3">
              <Input placeholder="Full Name" {...addForm.register('fullName', { required: true })} />
              <Select options={parents.map(p => ({ value: p.id, label: p.fullName }))} placeholder="Select Parent / Guardian" {...addForm.register('parentId')} />
              <Input placeholder="Primary Phone Number" {...addForm.register('phoneNumber')} />
              <Input placeholder="Emergency Contact" {...addForm.register('emergencyContact')} />
              <Input placeholder="Address" {...addForm.register('homeAddress')} />
              <Select
                options={[{ value: 'house', label: 'House / Villa' }, { value: 'apartment', label: 'Apartment' }]}
                placeholder="Residence Type (optional)"
                {...addForm.register('residenceType')}
              />
              <Input placeholder="Block / Building Number (optional)" {...addForm.register('blockNumber')} />
              <Input label="Date of Birth" type="date" {...addForm.register('dateOfBirth')} />
              <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="Select Class" {...addForm.register('classId')} />
              <Button type="submit" loading={addSubmitting} fullWidth>Send</Button>
            </form>
          </Card>

          <Card>
            <h2 className="font-bold text-gray-900 mb-3 text-center">Upload Students</h2>
            <p className="text-xs text-gray-500 mb-1">Excel columns: <span className="font-medium text-gray-700">Full Name, Primary Phone Number, Parent Phone, Emergency Contact, Date of Birth, Grade, Address, Residence Type, Block Number</span></p>
            <p className="text-xs text-gray-400 mb-3">Optional: Parent Phone, Address, Residence Type (house/apartment), Block Number. New classes created automatically.</p>
            <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 rounded-xl p-3 hover:border-primary-400 transition-colors">
              <Paperclip className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-500 truncate">{uploadFile ? uploadFile.name : 'Choose .xlsx or .xls file'}</span>
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={e => { setUploadFile(e.target.files?.[0] || null); setUploadResult(null); }}
              />
            </label>
            <Button className="mt-3" fullWidth loading={uploadLoading} onClick={onBulkUpload}>Upload</Button>
            {uploadResult && (
              <div className="mt-3 text-sm space-y-1">
                <p className="text-green-700 font-medium">{uploadResult.created} added · {uploadResult.skipped} skipped (already exist) · {uploadResult.total} total in file</p>
                {uploadResult.parentAccountsCreated > 0 && (
                  <p className="text-green-600 text-xs">{uploadResult.parentAccountsCreated} parent account{uploadResult.parentAccountsCreated !== 1 ? 's' : ''} created — default password: <span className="font-mono font-semibold">Parent@123</span></p>
                )}
                {uploadResult.autoCreatedClasses.length > 0 && (
                  <p className="text-blue-600 text-xs">Auto-created classes: {uploadResult.autoCreatedClasses.join(', ')}</p>
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
              <Input placeholder="Search students by name, address or phone..." icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="w-48">
              <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="All Classes" value={classFilter} onChange={e => setClassFilter(e.target.value)} />
            </div>
          </div>
          {/* Search results — click to load into Edit Student form */}
          {debouncedSearch && students.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">{students.length} student{students.length !== 1 ? 's' : ''} found — click to edit</span>
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
                        {(s as any).classes?.name || 'No class'}
                        {(s as any).parents?.residenceType && (
                          <span className="ml-2 text-gray-400">
                            · {(s as any).parents.residenceType === 'apartment' ? 'Apt' : 'House'}
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
              <h2 className="font-bold text-gray-900 mb-4 text-center">Remove Students</h2>
              <div className="space-y-3">
                <Select
                  options={classes.map(c => ({ value: c.id, label: c.name }))}
                  placeholder="Filter by Class (optional)"
                  value={removeClassId}
                  onChange={e => { setRemoveClassId(e.target.value); setRemoveStudentIds(new Set()); }}
                />
                {/* Multi-select checkbox list */}
                {filteredByRemoveClass.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {removeStudentIds.size > 0
                          ? `${removeStudentIds.size} selected`
                          : 'Select students to remove'}
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
                        {removeStudentIds.size === filteredByRemoveClass.length ? 'Deselect all' : 'Select all'}
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
                            <p className="text-xs text-gray-400">{(s as any).classes?.name || 'No class'}</p>
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
                        ? `Remove ${removeStudentIds.size} Student${removeStudentIds.size > 1 ? 's' : ''}`
                        : 'Remove'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {removeClassId ? 'No students in this class' : 'Select a class or leave empty to see all students'}
                  </p>
                )}
              </div>
            </Card>

            {archiveEnabled && (
              <Card>
                <h2 className="font-bold text-gray-900 mb-4 text-center">Archive Student</h2>
                <p className="text-xs text-gray-400 mb-3 text-center">Saves grades &amp; parent info, then removes from active roster</p>
                <div className="space-y-3">
                  <Select
                    options={classes.map(c => ({ value: c.id, label: c.name }))}
                    placeholder="Filter by Class (optional)"
                    value={archiveFilterClassId}
                    onChange={e => { setArchiveFilterClassId(e.target.value); setArchiveStudentId(''); }}
                  />
                  <Select
                    options={(archiveFilterClassId ? students.filter(s => s.classId === archiveFilterClassId) : students).map(s => ({ value: s.id, label: s.fullName }))}
                    placeholder="Select Student"
                    value={archiveStudentId}
                    onChange={e => setArchiveStudentId(e.target.value)}
                  />
                  <Select
                    options={[
                      { value: 'transferred', label: 'Transferred to another school' },
                      { value: 'withdrew', label: 'Withdrew' },
                    ]}
                    placeholder="Reason for leaving"
                    value={archiveReason}
                    onChange={e => setArchiveReason(e.target.value)}
                  />
                  <Input
                    label="Departure Date"
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
                    Archive Student
                  </Button>
                </div>
              </Card>
            )}
        </div>

        {/* Edit Student */}
        <Card className="max-w-xl" id="edit-student-section" style={{ scrollMarginTop: '80px' } as React.CSSProperties}>
          <h2 className="font-bold text-gray-900 mb-4 text-center">Edit Student</h2>
          <div className="space-y-3">
            <Select
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder="Filter by Class (optional)"
              value={editFilterClassId}
              onChange={e => { setEditFilterClassId(e.target.value); setEditStudentId(''); }}
            />
            <Select
              options={(editFilterClassId ? students.filter(s => s.classId === editFilterClassId) : students).map(s => ({ value: s.id, label: s.fullName }))}
              placeholder="Select Student"
              value={editStudentId}
              onChange={e => setEditStudentId(e.target.value)}
            />
            {editStudentId && (
              <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3 pt-2">
                <Input placeholder="Full Name" {...editForm.register('fullName')} />
                <Select options={parents.map(p => ({ value: p.id, label: p.fullName }))} placeholder="Select Parent / Guardian" {...editForm.register('parentId')} />
                <Input placeholder="Primary Phone Number" {...editForm.register('phoneNumber')} />
                <Input placeholder="Emergency Contact" {...editForm.register('emergencyContact')} />
                <Input placeholder="Address" {...editForm.register('homeAddress')} />
                <Select
                  options={[{ value: 'house', label: 'House / Villa' }, { value: 'apartment', label: 'Apartment' }]}
                  placeholder="Residence Type (optional)"
                  {...editForm.register('residenceType')}
                />
                <Input placeholder="Block / Building Number (optional)" {...editForm.register('blockNumber')} />
                <Input label="Date of Birth" type="date" {...editForm.register('dateOfBirth')} />
                <Select options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder="Select Class" {...editForm.register('classId')} />
                <Button type="submit" loading={editSubmitting} fullWidth>Send</Button>
              </form>
            )}
          </div>
        </Card>

        {/* Assign Students (Bulk) */}
        <Card className="max-w-2xl">
          <h2 className="font-bold text-gray-900 mb-1 text-center">Assign Students</h2>
          <p className="text-xs text-gray-500 text-center mb-4">Select a class, uncheck students to exclude, then assign all to a new class</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Current Class:</p>
              <Select
                options={classes.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select Class"
                value={assignCurrentClassId}
                onChange={e => { setAssignCurrentClassId(e.target.value); setExcludedStudentIds(new Set()); }}
              />
              {filteredByAssignClass.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Uncheck to exclude from assignment:</p>
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
                    {filteredByAssignClass.length - excludedStudentIds.size} of {filteredByAssignClass.length} students will be assigned
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">New Class:</p>
              <Select
                options={classes.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select Class"
                value={bulkNewClassId}
                onChange={e => setBulkNewClassId(e.target.value)}
              />
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input type="checkbox" checked={bulkGraduated} onChange={e => setBulkGraduated(e.target.checked)} className="w-4 h-4 text-primary-600" />
                <span className="text-sm text-gray-700">Mark as Graduated</span>
              </label>
            </div>
          </div>
          <Button
            loading={assignSubmitting}
            fullWidth
            disabled={!assignCurrentClassId || filteredByAssignClass.length === excludedStudentIds.size}
            onClick={() => onAssign({})}
          >
            Assign {filteredByAssignClass.length - excludedStudentIds.size} Students
          </Button>
        </Card>
      </div>}
    </PageLayout>
  );
}
