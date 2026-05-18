import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Search, History } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import ArchiveReasonModal from '../../components/common/ArchiveReasonModal';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../components/common/ReturningEmployeeSearch';
import type { Class, Driver, Student } from '../../types';

interface InactiveUser { id: string; firstName: string; lastName: string; username: string; role: string; }

export default function DriversManagement() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const addForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; licenseNumber: string; busNumber: string; age: string; username: string; password: string; vehicleType: string }>();
  const editForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; licenseNumber: string; busNumber: string; age: string; remove: boolean; vehicleType: string }>();

  const watchedAddName = addForm.watch('fullName');
  const debouncedAddName = useDebounce(watchedAddName ?? '', 350);
  const [inactiveMatches, setInactiveMatches] = useState<InactiveUser[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [addStudentIds, setAddStudentIds] = useState<string[]>([]);
  const [editStudentIds, setEditStudentIds] = useState<string[]>([]);
  const [editStudentsDirty, setEditStudentsDirty] = useState(false);
  const [addStudentSearch, setAddStudentSearch] = useState('');
  const [addStudentClass, setAddStudentClass] = useState('');
  const [editStudentSearch, setEditStudentSearch] = useState('');
  const [editStudentClass, setEditStudentClass] = useState('');

  const load = () => {
    adminApi.getDrivers().then(r => setDrivers(r.data || []));
    adminApi.getAllStudents().then(r => setStudents(r.data?.students || []));
    adminApi.getClasses().then(r => setClasses(r.data || []));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const name = (debouncedAddName ?? '').trim();
    if (name.length < 2) { setInactiveMatches([]); return; }
    adminApi.searchInactiveUsers(name, 'driver')
      .then(r => setInactiveMatches((r.data ?? []) as InactiveUser[]))
      .catch(() => setInactiveMatches([]));
  }, [debouncedAddName]);

  const reactivateInactive = async (u: InactiveUser) => {
    if (!confirm(`Reactivate ${u.firstName} ${u.lastName} (${u.username})?`)) return;
    const newPassword = prompt('Set a new password (or leave blank to keep the existing one):', '');
    if (newPassword === null) return;
    setReactivatingId(u.id);
    try {
      const r = await adminApi.reactivateUser(u.id, newPassword.trim() || undefined);
      const tail = r.data?.passwordReset ? ` New password: ${newPassword}` : '';
      toast.success(`Driver reactivated. Login: ${u.username}.${tail}`, { autoClose: 8000 });
      addForm.reset();
      setInactiveMatches([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reactivate');
    } finally { setReactivatingId(null); }
  };

  useEffect(() => {
    if (!selectedDriverId) return;
    const d = drivers.find(d => d.id === selectedDriverId);
    if (!d) return;
    editForm.setValue('fullName', d.fullName);
    editForm.setValue('phoneNumber', d.phoneNumber || '');
    editForm.setValue('emergencyContact', d.emergencyContact || '');
    editForm.setValue('licenseNumber', d.licenseNumber || '');
    editForm.setValue('busNumber', d.buses?.busNumber || '');
    editForm.setValue('vehicleType', d.vehicleType || 'bus');
    setEditStudentIds(students.filter(s => s.driverId === selectedDriverId).map(s => s.id));
    setEditStudentsDirty(false);
  }, [selectedDriverId, drivers, students]);

  const onAdd = async (data: any) => {
    setAddSubmitting(true);
    try {
      const res = await adminApi.createDriver({
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        licenseNumber: data.licenseNumber,
        busNumber: data.busNumber,
        age: data.age || undefined,
        username: data.username || undefined,
        password: data.password || undefined,
        vehicleType: data.vehicleType || 'bus',
        studentIds: addStudentIds,
        previousArchiveId: prevArchiveId || undefined,
      });
      const tempPw = res.data?.tempPassword || 'Driver@123';
      toast.success(`Driver added! Login: ${res.data?.username} / Password: ${tempPw}`);
      addForm.reset();
      setAddStudentIds([]);
      setPrevArchiveId(null);
      setPrevArchiveLabel('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add driver');
    } finally {
      setAddSubmitting(false);
    }
  };

  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');

  const onEdit = async (data: any) => {
    if (!selectedDriverId) { toast.error('Select a driver first'); return; }
    setEditSubmitting(true);
    try {
      const payload: Record<string, unknown> = { ...data, vehicleType: data.vehicleType || 'bus' };
      if (editStudentsDirty) payload.studentIds = editStudentIds;
      await adminApi.updateDriver(selectedDriverId, payload);
      toast.success('Driver updated!');
      setEditStudentsDirty(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update driver');
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedDriverId) { toast.error('Select a driver first'); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.deleteDriver(selectedDriverId, { reason, departureDate });
      toast.success('Driver removed');
      setRemoveOpen(false);
      setSelectedDriverId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove driver');
    } finally {
      setRemoving(false);
    }
  };

  const toggleStudent = (id: string, list: string[], setter: (v: string[]) => void, markDirty?: () => void) => {
    setter(list.includes(id) ? list.filter(s => s !== id) : [...list, id]);
    markDirty?.();
  };

  // Drivers whose IDs appear in students belonging to the selected class
  const driverIdsInClass = classFilter
    ? new Set(students.filter(s => s.classId === classFilter && s.driverId).map(s => s.driverId!))
    : null;

  const filteredDrivers = drivers.filter(d => {
    if (classFilter && !driverIdsInClass!.has(d.id)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(d.fullName || '').toLowerCase().includes(q) &&
          !(d.buses?.busNumber || '').toLowerCase().includes(q) &&
          !(d.phoneNumber || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <PageLayout title="Drivers Management">
      {/* Search & Filter */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search by name, bus number, or phone..."
              icon={<Search className="w-4 h-4" />}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="sm:w-52">
            <Select
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder="All Classes"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
            />
          </div>
        </div>
        {filteredDrivers.length > 0 && (
          <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {filteredDrivers.map(d => {
              const assigned = students.filter(s => s.driverId === d.id);
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-700 font-bold text-sm">{(d.fullName || '?')[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{d.fullName}</p>
                    <p className="text-xs text-gray-500">
                      {d.buses?.busNumber ? `Bus ${d.buses.busNumber}` : 'No bus'}{d.phoneNumber ? ` · ${d.phoneNumber}` : ''}
                    </p>
                    {assigned.length > 0 && (
                      <p className="text-xs text-gray-400 truncate">{assigned.map(s => s.fullName).join(', ')}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{assigned.length} student{assigned.length !== 1 ? 's' : ''}</span>
                </div>
              );
            })}
          </div>
        )}
        {(search || classFilter) && filteredDrivers.length === 0 && (
          <p className="text-sm text-gray-400 text-center mt-3 py-2">No drivers match the current filter.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Driver */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Add Driver</h2>
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
                <div className="text-xs text-amber-700 mt-2">If this is a returning driver, click their record to reactivate. Otherwise just continue filling in the form for a new driver.</div>
              </div>
            )}
            <ReturningEmployeeSearch
              role="driver"
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
            <Input placeholder="Licence Number" {...addForm.register('licenseNumber')} />
            <Select
              options={[{ value: 'bus', label: 'Bus' }, { value: 'taxi', label: 'Taxi' }]}
              placeholder="Vehicle Type"
              {...addForm.register('vehicleType')}
            />
            <Input placeholder="Vehicle / Bus Number" {...addForm.register('busNumber')} />
            <Input type="number" placeholder="Age" {...addForm.register('age')} />
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Assign Students</p>
                {addStudentIds.length > 0 && (
                  <span className="text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                    {addStudentIds.length} selected
                  </span>
                )}
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Search students..."
                  value={addStudentSearch}
                  onChange={e => setAddStudentSearch(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-300"
                />
                <select
                  value={addStudentClass}
                  onChange={e => setAddStudentClass(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-300"
                >
                  <option value="">All classes</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl">
                {(() => {
                  const filtered = students.filter(s => {
                    if (addStudentClass && s.classId !== addStudentClass) return false;
                    if (addStudentSearch && !(s.fullName || '').toLowerCase().includes(addStudentSearch.toLowerCase())) return false;
                    return true;
                  });
                  const grouped = new Map<string, { className: string; students: typeof filtered }>();
                  for (const s of filtered) {
                    const key = s.classId || '_none';
                    if (!grouped.has(key)) grouped.set(key, { className: s.classes?.name || 'No Class', students: [] });
                    grouped.get(key)!.students.push(s);
                  }
                  return [...grouped.entries()].sort((a, b) => a[1].className.localeCompare(b[1].className)).map(([key, { className, students: grpStudents }]) => (
                    <div key={key}>
                      <div className="sticky top-0 bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{className}</span>
                        <span className="text-xs text-gray-400 ml-1">({grpStudents.length})</span>
                      </div>
                      {grpStudents.map((s: Student) => {
                        const isSelected = addStudentIds.includes(s.id);
                        return (
                          <label key={s.id} className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 transition-colors ${isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleStudent(s.id, addStudentIds, setAddStudentIds)} className="w-4 h-4 text-primary-600 rounded" />
                            <span className={`text-sm flex-1 ${isSelected ? 'font-semibold text-primary-700' : 'text-gray-800'}`}>{s.fullName}</span>
                            {s.driverId && (
                              <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium">
                                {drivers.find(d => d.id === s.driverId)?.fullName || 'Has driver'}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            </div>
            <Input placeholder="Username (optional)" {...addForm.register('username')} />
            <Input type="password" placeholder="Password (default: Driver@123)" {...addForm.register('password')} />
            <Button type="submit" loading={addSubmitting} fullWidth>Send</Button>
          </form>
        </Card>

        {/* Edit Driver */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Edit Driver</h2>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
            <Select
              options={drivers.map(d => ({ value: d.id, label: d.fullName || '(Unnamed Driver)' }))}
              placeholder="Select Driver"
              value={selectedDriverId}
              onChange={e => setSelectedDriverId(e.target.value)}
            />
            <Input placeholder="Full Name" {...editForm.register('fullName')} />
            <Input placeholder="Primary Phone Number" {...editForm.register('phoneNumber')} />
            <Input placeholder="Emergency Contact" {...editForm.register('emergencyContact')} />
            <Input placeholder="Licence Number" {...editForm.register('licenseNumber')} />
            <Select
              options={[{ value: 'bus', label: 'Bus' }, { value: 'taxi', label: 'Taxi' }]}
              placeholder="Vehicle Type"
              {...editForm.register('vehicleType')}
            />
            <Input placeholder="Vehicle / Bus Number" {...editForm.register('busNumber')} />
            <Input type="number" placeholder="Age" {...editForm.register('age')} />
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Assign Students</p>
                {editStudentIds.length > 0 && (
                  <span className="text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                    {editStudentIds.length} assigned
                  </span>
                )}
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Search students..."
                  value={editStudentSearch}
                  onChange={e => setEditStudentSearch(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-300"
                />
                <select
                  value={editStudentClass}
                  onChange={e => setEditStudentClass(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-300"
                >
                  <option value="">All classes</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl">
                {(() => {
                  const filtered = students.filter(s => {
                    if (editStudentClass && s.classId !== editStudentClass) return false;
                    if (editStudentSearch && !(s.fullName || '').toLowerCase().includes(editStudentSearch.toLowerCase())) return false;
                    return true;
                  });
                  // Group by class
                  const grouped = new Map<string, { className: string; students: typeof filtered }>();
                  for (const s of filtered) {
                    const key = s.classId || '_none';
                    if (!grouped.has(key)) grouped.set(key, { className: s.classes?.name || 'No Class', students: [] });
                    grouped.get(key)!.students.push(s);
                  }
                  // Sort: classes with assigned students first
                  const entries = [...grouped.entries()].sort((a, b) => {
                    const aHas = a[1].students.some(s => editStudentIds.includes(s.id)) ? 0 : 1;
                    const bHas = b[1].students.some(s => editStudentIds.includes(s.id)) ? 0 : 1;
                    return aHas - bHas || a[1].className.localeCompare(b[1].className);
                  });
                  return entries.map(([key, { className, students: classStudents }]) => (
                    <div key={key}>
                      <div className="sticky top-0 bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{className}</span>
                        <span className="text-xs text-gray-400 ml-1">({classStudents.length})</span>
                      </div>
                      {classStudents.map(s => {
                        const isAssigned = editStudentIds.includes(s.id);
                        const assignedToOther = !isAssigned && s.driverId && s.driverId !== selectedDriverId;
                        return (
                          <label key={s.id} className={`flex items-center gap-2 cursor-pointer px-3 py-1.5 transition-colors ${isAssigned ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => toggleStudent(s.id, editStudentIds, setEditStudentIds, () => setEditStudentsDirty(true))}
                              className="w-4 h-4 text-primary-600 rounded"
                            />
                            <span className={`text-sm flex-1 ${isAssigned ? 'font-semibold text-primary-700' : 'text-gray-800'}`}>{s.fullName}</span>
                            {assignedToOther && (
                              <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium">
                                {drivers.find(d => d.id === s.driverId)?.fullName || 'Other driver'}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
              {editStudentsDirty && (
                <p className="text-xs text-amber-600 mt-1 font-medium">Student assignments changed — click Update to save</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedDriverId}>Update Driver</Button>
              <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedDriverId}>Remove</Button>
            </div>
          </form>
        </Card>
      </div>
      <ArchiveReasonModal
        isOpen={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={doRemove}
        busy={removing}
        entityLabel="driver"
      />
    </PageLayout>
  );
}
