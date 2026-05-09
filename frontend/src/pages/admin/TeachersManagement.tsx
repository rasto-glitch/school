import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { History } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Teacher, Class } from '../../types';

interface Subject { id: string; name: string; teacherId?: string; }
interface InactiveUser { id: string; firstName: string; lastName: string; username: string; role: string; }

export default function TeachersManagement() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const addForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; subject: string; classId: string; username: string; password: string }>();
  const editForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; subject: string; classId: string; remove: boolean }>();

  const watchedAddName = addForm.watch('fullName');
  const debouncedAddName = useDebounce(watchedAddName ?? '', 350);
  const [inactiveMatches, setInactiveMatches] = useState<InactiveUser[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const load = () => {
    adminApi.getTeachers().then(r => setTeachers(r.data || []));
    adminApi.getClasses().then(r => setClasses(r.data || []));
    adminApi.getSubjects().then(r => setSubjects(r.data || []));
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
    const newPassword = prompt('Set a new password (or leave blank to keep the existing one):', '');
    if (newPassword === null) return; // cancelled
    setReactivatingId(u.id);
    try {
      const r = await adminApi.reactivateUser(u.id, newPassword.trim() || undefined);
      const tail = r.data?.passwordReset ? ` New password: ${newPassword}` : '';
      toast.success(`Teacher reactivated. Login: ${u.username}.${tail}`, { autoClose: 8000 });
      addForm.reset();
      setInactiveMatches([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reactivate');
    } finally { setReactivatingId(null); }
  };

  // Populate edit form when teacher is selected
  useEffect(() => {
    if (!selectedTeacherId) return;
    const t = teachers.find(t => t.id === selectedTeacherId);
    if (!t) return;
    editForm.setValue('fullName', t.fullName);
    editForm.setValue('phoneNumber', t.phoneNumber || '');
    editForm.setValue('emergencyContact', t.emergencyContact || '');
    editForm.setValue('subject', t.subject || '');
    const existingClassIds = ((t as any).teacherClasses || []).map((tc: any) => tc.classId);
    setEditClassIds(existingClassIds);
  }, [selectedTeacherId, teachers]);

  const onAdd = async (data: any) => {
    setAddSubmitting(true);
    try {
      const res = await adminApi.createTeacher({
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        subject: data.subject,
        classIds: addClassIds,
        username: data.username || undefined,
        password: data.password || undefined,
      });
      const tempPw = res.data?.tempPassword || 'Teacher@123';
      toast.success(`Teacher added! Login: ${res.data?.username} / Password: ${tempPw}`);
      addForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add teacher');
    } finally {
      setAddSubmitting(false);
    }
  };

  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [addClassIds, setAddClassIds] = useState<string[]>([]);

  const toggleClass = (id: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter(c => c !== id) : [...list, id]);

  const [removing, setRemoving] = useState(false);

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

  const onRemove = async () => {
    if (!selectedTeacherId) { toast.error('Select a teacher first'); return; }
    if (!confirm('Deactivate this teacher? They will no longer be able to log in.')) return;
    setRemoving(true);
    try {
      await adminApi.deleteTeacher(selectedTeacherId);
      toast.success('Teacher deactivated');
      setSelectedTeacherId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove teacher');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <PageLayout title="Teachers Management">
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
              <Input placeholder="Primary Phone Number" {...addForm.register('phoneNumber')} />
              <Input placeholder="Emergency Contact" {...addForm.register('emergencyContact')} />
              <Select
                options={subjects.map(s => ({ value: s.name, label: s.name }))}
                placeholder="Select Subject"
                {...addForm.register('subject')}
              />
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
              </div>
              <Input placeholder="Username (optional)" {...addForm.register('username')} />
              <Input type="password" placeholder="Password (default: Teacher@123)" {...addForm.register('password')} />
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
              <Select
                options={subjects.map(s => ({ value: s.name, label: s.name }))}
                placeholder="Select Subject"
                {...editForm.register('subject')}
              />
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
              </div>
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedTeacherId}>Update Teacher</Button>
                <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedTeacherId}>Remove</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
