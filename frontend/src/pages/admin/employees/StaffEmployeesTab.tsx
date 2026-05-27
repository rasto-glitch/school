import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation, Trans } from 'react-i18next';
import { toast } from 'react-toastify';
import { Info } from 'lucide-react';
import { adminApi } from '../../../services/api';
import Card from '../../../components/common/Card';
import Input from '../../../components/common/Input';
import Select from '../../../components/common/Select';
import Button from '../../../components/common/Button';
import ArchiveReasonModal from '../../../components/common/ArchiveReasonModal';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../../components/common/ReturningEmployeeSearch';
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../../../components/admin/EmployeeHRFields';
import ProfessionalPhotoField from '../../../components/admin/ProfessionalPhotoField';
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
  const { t } = useTranslation();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Two-phase Add: id of the just-created staff member → reveals the photo
  // field in place and turns the button into "Save". Saved regardless.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const addForm = useForm<{ fullName: string; position: string; emergencyContact: string } & EmployeeHRFormFields>();
  const editForm = useForm<{ fullName: string; position: string; emergencyContact: string } & EmployeeHRFormFields>();

  const watchedAddName = addForm.watch('fullName');
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');

  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = () => {
    adminApi.getStaff('active')
      .then(r => setStaff((r.data || []) as StaffMember[]))
      .catch((e: any) => toast.error(e.response?.data?.error || t('admin.staff_emp.failed_load')));
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => staff.find(s => s.id === selectedId) || null, [staff, selectedId]);

  useEffect(() => {
    if (!selected) return;
    const sm = selected as any;
    editForm.setValue('fullName', selected.fullName);
    editForm.setValue('position', selected.position || '');
    editForm.setValue('emergencyContact', sm.emergencyContact || '');
    editForm.setValue('address', sm.address || '');
    editForm.setValue('hireDate', sm.hireDate || '');
    editForm.setValue('nationalId', sm.nationalId || '');
    editForm.setValue('dateOfBirth', sm.dateOfBirth || '');
    editForm.setValue('maritalStatus', sm.maritalStatus || '');
    editForm.setValue('gender', sm.gender || '');
    editForm.setValue('employmentType', sm.employmentType || '');
    editForm.setValue('qualifications', sm.qualifications || '');
    editForm.setValue('notes', sm.notes || '');
  }, [selected]);

  const onAdd = async (data: any) => {
    setAddSubmitting(true);
    try {
      // Salary is a placeholder until the accountant sets it in Accounting.
      const res = await adminApi.createStaff({
        ...hrPayload(data),
        fullName: data.fullName,
        position: data.position || null,
        emergencyContact: data.emergencyContact || undefined,
        salaryAmount: 0,
        currency: 'USD',
        previousArchiveId: prevArchiveId || undefined,
      });
      toast.success(t('admin.staff_emp.added'), { autoClose: 8000 });
      // Enter the photo phase — keep the form filled.
      setCreatedId(res.data?.id ?? null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.staff_emp.failed_add'));
    } finally {
      setAddSubmitting(false);
    }
  };

  // Save phase: persist edits to the just-created staff member (works with or
  // without a photo), then reset to a blank Add form.
  const onSave = async (data: any) => {
    if (!createdId) return;
    setAddSubmitting(true);
    try {
      await adminApi.updateStaff(createdId, {
        ...hrPayload(data),
        fullName: data.fullName,
        position: data.position || null,
        emergencyContact: data.emergencyContact || null,
      });
      toast.success(t('admin.staff_emp.saved'));
      addForm.reset();
      setPrevArchiveId(null);
      setPrevArchiveLabel('');
      setCreatedId(null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.staff_emp.failed_save'));
    } finally {
      setAddSubmitting(false);
    }
  };

  const onEdit = async (data: any) => {
    if (!selectedId) { toast.error(t('admin.staff_emp.select_first')); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateStaff(selectedId, {
        ...hrPayload(data),
        fullName: data.fullName,
        position: data.position || null,
        emergencyContact: data.emergencyContact || null,
      });
      toast.success(t('admin.staff_emp.updated'));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.staff_emp.failed_update'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedId) { toast.error(t('admin.staff_emp.select_first')); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.archiveStaff(selectedId, { reason, departureDate });
      toast.success(t('admin.staff_emp.archived'));
      setRemoveOpen(false);
      setSelectedId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.staff_emp.failed_archive'));
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
            <Trans i18nKey="admin.staff_emp.finance_note" components={{ b: <span className="font-medium" /> }} />
          </span>
        </div>

        <div className="space-y-6">
          {/* Add Staff — full width, two-phase (Add → attach photo → Save) */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">{t('admin.staff_emp.add_staff')}</h2>
            <form onSubmit={addForm.handleSubmit(createdId ? onSave : onAdd)} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.full_name')}</label>
                  <Input placeholder={t('admin.staff_emp.full_name')} {...addForm.register('fullName', { required: true })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.position')}</label>
                  <Input placeholder={t('admin.staff_emp.position_ph')} {...addForm.register('position')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.emergency_contact')}</label>
                  <Input placeholder={t('admin.staff_emp.emergency_contact')} {...addForm.register('emergencyContact')} />
                </div>
              </div>
              {!createdId && (
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
              )}
              <EmployeeHRFields register={addForm.register} />
              {createdId && (
                <>
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
                    {t('admin.staff_emp.photo_phase_hint')}
                  </div>
                  <ProfessionalPhotoField
                    role="staff"
                    employeeId={createdId}
                    currentUrl={null}
                    onUploaded={() => load()}
                  />
                </>
              )}
              <Button type="submit" loading={addSubmitting} fullWidth>{createdId ? t('admin.staff_emp.save') : t('admin.staff_emp.add')}</Button>
            </form>
          </Card>

          {/* Edit Staff — full width, stacked below Add */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">{t('admin.staff_emp.edit_staff')}</h2>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
              <Select
                label={t('admin.staff_emp.select_staff')}
                options={staff.map(s => ({ value: s.id, label: s.fullName || t('admin.staff_emp.unnamed') }))}
                placeholder={t('admin.staff_emp.select_staff')}
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              />
              <Input placeholder={t('admin.staff_emp.full_name')} {...editForm.register('fullName')} />
              <Input placeholder={t('admin.staff_emp.position')} {...editForm.register('position')} />
              <Input placeholder={t('admin.staff_emp.emergency_contact')} {...editForm.register('emergencyContact')} />
              {selected && <EmployeeHRFields register={editForm.register} />}
              {selected && (
                <ProfessionalPhotoField
                  role="staff"
                  employeeId={selected.id}
                  currentUrl={(selected as any).officialPhoto ?? null}
                  onUploaded={() => load()}
                />
              )}
              {selected && (selected.salaryAmount > 0 || selected.nextPaymentDate) && (
                <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">
                  {t('admin.staff_emp.salary_configured')}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedId}>{t('admin.staff_emp.update_staff')}</Button>
                <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedId}>{t('admin.staff_emp.remove')}</Button>
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
        entityLabel={t('admin.staff_emp.entity')}
      />
    </>
  );
}
