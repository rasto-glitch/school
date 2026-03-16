import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Search } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, Driver, Student } from '../../types';

export default function DriversManagement() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const addForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; licenseNumber: string; busNumber: string; age: string; username: string; password: string }>();
  const editForm = useForm<{ fullName: string; phoneNumber: string; emergencyContact: string; licenseNumber: string; busNumber: string; age: string; remove: boolean }>();
  const [addStudentIds, setAddStudentIds] = useState<string[]>([]);
  const [editStudentIds, setEditStudentIds] = useState<string[]>([]);
  const [addStudentSearch, setAddStudentSearch] = useState('');
  const [addStudentClass, setAddStudentClass] = useState('');
  const [editStudentSearch, setEditStudentSearch] = useState('');
  const [editStudentClass, setEditStudentClass] = useState('');

  const load = () => {
    adminApi.getDrivers().then(r => setDrivers(r.data || []));
    adminApi.getStudents().then(r => setStudents(r.data?.students || []));
    adminApi.getClasses().then(r => setClasses(r.data || []));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedDriverId) return;
    const d = drivers.find(d => d.id === selectedDriverId);
    if (!d) return;
    editForm.setValue('fullName', d.fullName);
    editForm.setValue('phoneNumber', d.phoneNumber || '');
    editForm.setValue('emergencyContact', d.emergencyContact || '');
    editForm.setValue('licenseNumber', d.licenseNumber || '');
    editForm.setValue('busNumber', d.buses?.busNumber || '');
    setEditStudentIds(students.filter(s => s.driverId === selectedDriverId).map(s => s.id));
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
        studentIds: addStudentIds,
      });
      const tempPw = res.data?.tempPassword || 'Driver@123';
      toast.success(`Driver added! Login: ${res.data?.username} / Password: ${tempPw}`);
      addForm.reset();
      setAddStudentIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add driver');
    } finally {
      setAddSubmitting(false);
    }
  };

  const [removing, setRemoving] = useState(false);

  const onEdit = async (data: any) => {
    if (!selectedDriverId) { toast.error('Select a driver first'); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateDriver(selectedDriverId, { ...data, studentIds: editStudentIds });
      toast.success('Driver updated!');
      setEditStudentIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update driver');
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = async () => {
    if (!selectedDriverId) { toast.error('Select a driver first'); return; }
    if (!confirm('Deactivate this driver? They will no longer be able to log in.')) return;
    setRemoving(true);
    try {
      await adminApi.deleteDriver(selectedDriverId);
      toast.success('Driver deactivated');
      setSelectedDriverId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove driver');
    } finally {
      setRemoving(false);
    }
  };

  const toggleStudent = (id: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter(s => s !== id) : [...list, id]);
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
            <Input placeholder="Primary Phone Number" {...addForm.register('phoneNumber')} />
            <Input placeholder="Emergency Contact" {...addForm.register('emergencyContact')} />
            <Input placeholder="Licence Number" {...addForm.register('licenseNumber')} />
            <Input placeholder="Bus Number" {...addForm.register('busNumber')} />
            <Input type="number" placeholder="Age" {...addForm.register('age')} />
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Assign Students</p>
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
              <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                {students
                  .filter(s => {
                    if (addStudentClass && s.classId !== addStudentClass) return false;
                    if (addStudentSearch && !(s.fullName || '').toLowerCase().includes(addStudentSearch.toLowerCase())) return false;
                    return true;
                  })
                  .map(s => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                      <input type="checkbox" checked={addStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id, addStudentIds, setAddStudentIds)} className="w-4 h-4 text-primary-600" />
                      <span className="text-sm text-gray-800">{s.fullName}</span>
                      {s.classes?.name && <span className="text-xs text-gray-400 ml-auto">{s.classes.name}</span>}
                    </label>
                  ))}
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
            <Input placeholder="Bus Number" {...editForm.register('busNumber')} />
            <Input type="number" placeholder="Age" {...editForm.register('age')} />
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Assign Students</p>
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
              <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
                {students
                  .filter(s => {
                    if (editStudentClass && s.classId !== editStudentClass) return false;
                    if (editStudentSearch && !(s.fullName || '').toLowerCase().includes(editStudentSearch.toLowerCase())) return false;
                    return true;
                  })
                  .map(s => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
                      <input type="checkbox" checked={editStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id, editStudentIds, setEditStudentIds)} className="w-4 h-4 text-primary-600" />
                      <span className="text-sm text-gray-800">{s.fullName}</span>
                      {s.classes?.name && <span className="text-xs text-gray-400 ml-auto">{s.classes.name}</span>}
                    </label>
                  ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedDriverId}>Update Driver</Button>
              <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedDriverId}>Remove</Button>
            </div>
          </form>
        </Card>
      </div>
    </PageLayout>
  );
}
