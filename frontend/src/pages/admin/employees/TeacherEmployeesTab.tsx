import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { History } from 'lucide-react';
import { adminApi } from '../../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../../utils/passwordPolicy';
import { useDebounce } from '../../../hooks/useDebounce';
import Card from '../../../components/common/Card';
import Input from '../../../components/common/Input';
import Select from '../../../components/common/Select';
import Button from '../../../components/common/Button';
import ArchiveReasonModal from '../../../components/common/ArchiveReasonModal';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../../components/common/ReturningEmployeeSearch';
import type { Teacher, Class } from '../../../types';

interface InactiveUser { id: string; firstName: string; lastName: string; username: string; role: string; }

// Teacher sub-tab of the Employees page. Behaviour is identical to the old
// standalone /admin/teachers page — only the outer PageLayout wrapper moved
// up to EmployeesManagement.
export default function TeacherEmployeesTab() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const addForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; classId: string; username: string; password: string }>();
  const editForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; classId: string; remove: boolean }>();

  const watchedAddName = addForm.watch('fullName');
  const debouncedAddName = useDebounce(watchedAddName ?? '', 350);
  const [inactiveMatches, setInactiveMatches] = useState<InactiveUser[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [addClassIds, setAddClassIds] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');

  const load = () => {
    adminApi.getTeachers().then(r => setTeachers(r.data || []));
    adminApi.getClasses().then(r => setClasses(r.data || []));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const name = (debouncedAddName ?? '').trim();
    if (name.length < 2) { setInactiveMatches([]); return; }
    adminApi.searchInactiveUsers(name, 'teacher')
      .then(r => setInactiveMatches((r.data ?? []) as InactiveUser[]))
      .catch(() => setInactiveMatches([]));
  }, [debouncedAddName]);

  const reactivateInactive = async (u: InactiveUser) => {
    if (!confirm(`Reactivate ${u.firstName} ${u.lastName} (${u.username})?`)) return;
    const newPassword = prompt('Set a new password (or leave blank to keep the existing one):\n\n' + PASSWORD_POLICY_MESSAGE, '');
    if (newPassword === null) return; // cancelled
    const trimmed = newPassword.trim();
    if (trimmed && !isStrongPassword(trimmed)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setReactivatingId(u.id);
    try {
      const r = await adminApi.reactivateUser(u.id, trimmed || undefined);
      const tail = r.data?.passwordReset ? ` New password: ${newPassword}` : '';
      toast.success(`Teacher reactivated. Login: ${u.username}.${tail}`, { autoClose: 8000 });
      addForm.reset();
      setInactiveMatches([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reactivate');
    } finally { setReactivatingId(null); }
  };

  const selectedTeacher = useMemo(() => teachers.find(t => t.id === selectedTeacherId) || null, [teachers, selectedTeacherId]);

  // Populate edit form when teacher is selected
  useEffect(() => {
    if (!selectedTeacher) return;
    editForm.setValue('fullName', selectedTeacher.fullName);
    editForm.setValue('phoneNumber', selectedTeacher.phoneNumber || '');
    editForm.setValue('emergencyContact', selectedTeacher.emergencyContact || '');
    setEditClassIds(((selectedTeacher as any).teacherClasses || []).map((tc: any) => tc.classId));
  }, [selectedTeacher]);

  const toggleClass = (id: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter(c => c !== id) : [...list, id]);

  const onAdd = async (data: any) => {
    if (data.password && !isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await adminApi.createTeacher({
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        classIds: addClassIds,
        username: data.username || undefined,
        password: data.password || undefined,
        previousArchiveId: prevArchiveId || undefined,
      });
      const tempPw = res.data?.tempPassword || 'Teacher@123';
      toast.success(`Teacher added! Login: ${res.data?.username} / Password: ${tempPw}. Assign their subjects in Class Management → Curriculum.`, { autoClose: 9000 });
      addForm.reset();
      setAddClassIds([]);
      setPrevArchiveId(null);
      setPrevArchiveLabel('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add teacher');
    } finally {
      setAddSubmitting(false);
    }
  };

  const onEdit = async (data: any) => {
    if (!selectedTeacherId) { toast.error('Select a teacher first'); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateTeacher(selectedTeacherId, { ...data, classIds: editClassIds });
      toast.success('Teacher updated!');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update teacher');
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedTeacherId) { toast.error('Select a teacher first'); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.deleteTeacher(selectedTeacherId, { reason, departureDate });
      toast.success('Teacher removed');
      setRemoveOpen(false);
      setSelectedTeacherId('');
      editForm.reset();
      setEditClassIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove teacher');
    } finally {
      setRemoving(false);
    }
  };

  const teachesSummary = (t: Teacher | null): string => {
    if (!t?.subjects?.length) return 'No subjects assigned yet';
    return t.subjects.map(s => {
      const cls = (s.classes || []).map(c => c.name).filter(Boolean);
      return cls.length ? `${s.name} (${cls.join(', ')})` : s.name;
    }).join('; ');
  };

  return (
    <>
      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Add Teacher */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Add Teacher</h2>
            <form onSubmit={addForm.handleSubmit(onAdd)} className="space-y-3">
              <Input placeholder="Full Name" {...addForm.register('fullName', { required: true })} />
              {inactiveMatches.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-amber-900 font-medium mb-2">
                    <History className="w-4 h-4" /> Previously deactivated match{inactiveMatches.length > 1 ? 'es' : ''}
                  </div>
                  <div className="space-y-1.5">
                    {inactiveMatches.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => reactivateInactive(u)}
                        disabled={reactivatingId === u.id}
                        className="w-full text-left bg-white hover:bg-amber-100 border border-amber-200 rounded px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <div className="font-medium text-gray-900">{u.firstName} {u.lastName}</div>
                        <div className="text-xs text-gray-600">{u.username} · click to reactivate</div>
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-amber-700 mt-2">If this is a returning teacher, click their record to reactivate. Otherwise just continue filling in the form for a new teacher.</div>
                </div>
              )}
              <ReturningEmployeeSearch
                role="teacher"
                nameQuery={watchedAddName}
                linkedId={prevArchiveId}
                linkedLabel={prevArchiveLabel}
                onPick={(c: ReturningEmployeeCandidate) => {
                  addForm.setValue('fullName', c.fullName);
                  setPrevArchiveId(c.id);
                  setPrevArchiveLabel(`${c.fullName} · ${c.reason}${c.departureDate ? ` ${c.departureDate}` : ''}`);
                }}
                onClear={() => { setPrevArchiveId(null); setPrevArchiveLabel(''); }}
              />
              <Input placeholder="Primary Phone Number" {...addForm.register('phoneNumber')} />
              <Input placeholder="Emergency Contact" {...addForm.register('emergencyContact')} />
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Assign Class(es)</p>
                <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                  {classes.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                      <input type="checkbox" checked={addClassIds.includes(c.id)} onChange={() => toggleClass(c.id, addClassIds, setAddClassIds)} className="w-4 h-4 text-primary-600" />
                      <span className="text-sm text-gray-800">{c.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Subjects are assigned per class in Class Management → Curriculum.</p>
              </div>
              <Input placeholder="Username (optional)" {...addForm.register('username')} />
              <Input type="password" placeholder="Password (default: Teacher@123 — or min 8 chars, 1 uppercase, 1 special)" {...addForm.register('password')} />
              <Button type="submit" loading={addSubmitting} fullWidth>Send</Button>
            </form>
          </Card>

          {/* Edit Teacher */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Edit Teacher</h2>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
              <Select
                label="Select Teacher"
                options={teachers.map(t => ({ value: t.id, label: t.fullName || '(Unnamed Teacher)' }))}
                placeholder="Select Teacher"
                value={selectedTeacherId}
                onChange={e => setSelectedTeacherId(e.target.value)}
              />
              <Input placeholder="Full Name" {...editForm.register('fullName')} />
              <Input placeholder="Primary Phone Number" {...editForm.register('phoneNumber')} />
              <Input placeholder="Emergency Contact" {...editForm.register('emergencyContact')} />
              {selectedTeacher && (
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Teaches</p>
                  <p className="text-sm text-gray-800">{teachesSummary(selectedTeacher)}</p>
                  <p className="text-xs text-gray-400 mt-1">Manage subjects per class in Class Management → Curriculum.</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Assign Class(es)</p>
                <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                  {classes.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                      <input type="checkbox" checked={editClassIds.includes(c.id)} onChange={() => toggleClass(c.id, editClassIds, setEditClassIds)} className="w-4 h-4 text-primary-600" />
                      <span className="text-sm text-gray-800">{c.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Removing a class also removes the subjects that teacher was teaching in it.</p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedTeacherId}>Update Teacher</Button>
                <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedTeacherId}>Remove</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
      <ArchiveReasonModal
        isOpen={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={doRemove}
        busy={removing}
        entityLabel="teacher"
      />
    </>
  );
}
