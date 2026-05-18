import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Info } from 'lucide-react';
import { adminApi } from '../../../services/api';
import Card from '../../../components/common/Card';
import Input from '../../../components/common/Input';
import Select from '../../../components/common/Select';
import Button from '../../../components/common/Button';
import ArchiveReasonModal from '../../../components/common/ArchiveReasonModal';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../../components/common/ReturningEmployeeSearch';
import type { StaffMember } from '../../../types';

// Staff sub-tab of the Employees page. HR / identity only — full name,
// position and archive. Salary, insurance and payments are the accountant's
// job and live in the Accounting portal (admin is excluded from finance).
// A new staff record is created with a 0 placeholder salary; the accountant
// sets the real figure in Accounting → Staff Salaries.
//
// Backed by /admin/staff (admin-authorized) which reuses the same
// staff_members table the accounting roster reads.

export default function StaffEmployeesTab() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const addForm = useForm<{ fullName: string; position: string }>();
  const editForm = useForm<{ fullName: string; position: string }>();

  const watchedAddName = addForm.watch('fullName');
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');

  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = () => {
    adminApi.getStaff('active')
      .then(r => setStaff((r.data || []) as StaffMember[]))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load staff'));
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => staff.find(s => s.id === selectedId) || null, [staff, selectedId]);

  useEffect(() => {
    if (!selected) return;
    editForm.setValue('fullName', selected.fullName);
    editForm.setValue('position', selected.position || '');
  }, [selected]);

  const onAdd = async (data: any) => {
    setAddSubmitting(true);
    try {
      // Salary is a placeholder until the accountant sets it in Accounting.
      await adminApi.createStaff({
        fullName: data.fullName,
        position: data.position || null,
        salaryAmount: 0,
        currency: 'USD',
        previousArchiveId: prevArchiveId || undefined,
      });
      toast.success('Staff member added. Set their salary in the Accounting portal.', { autoClose: 8000 });
      addForm.reset();
      setPrevArchiveId(null);
      setPrevArchiveLabel('');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add staff member');
    } finally {
      setAddSubmitting(false);
    }
  };

  const onEdit = async (data: any) => {
    if (!selectedId) { toast.error('Select a staff member first'); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateStaff(selectedId, {
        fullName: data.fullName,
        position: data.position || null,
      });
      toast.success('Staff member updated');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update staff member');
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedId) { toast.error('Select a staff member first'); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.archiveStaff(selectedId, { reason, departureDate });
      toast.success('Staff member archived');
      setRemoveOpen(false);
      setSelectedId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to archive staff member');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Salary, insurance and payments are managed by the accountant in the <span className="font-medium">Accounting portal</span>.
            New staff start with no salary set — add the figure there.
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Add Staff */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Add Staff</h2>
            <form onSubmit={addForm.handleSubmit(onAdd)} className="space-y-3">
              <Input placeholder="Full Name" {...addForm.register('fullName', { required: true })} />
              <ReturningEmployeeSearch
                role="staff"
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
              <Input placeholder="Position (e.g. Janitor, Cook, Guard)" {...addForm.register('position')} />
              <Button type="submit" loading={addSubmitting} fullWidth>Send</Button>
            </form>
          </Card>

          {/* Edit Staff */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Edit Staff</h2>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
              <Select
                label="Select Staff"
                options={staff.map(s => ({ value: s.id, label: s.fullName || '(Unnamed)' }))}
                placeholder="Select Staff"
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              />
              <Input placeholder="Full Name" {...editForm.register('fullName')} />
              <Input placeholder="Position" {...editForm.register('position')} />
              {selected && (selected.salaryAmount > 0 || selected.nextPaymentDate) && (
                <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">
                  Salary is configured in the Accounting portal.
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedId}>Update Staff</Button>
                <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedId}>Remove</Button>
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
        entityLabel="staff member"
      />
    </>
  );
}
