import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../../../components/admin/EmployeeHRFields';
import ProfessionalPhotoField from '../../../components/admin/ProfessionalPhotoField';

// Shared sub-tab for the bare-users-row employee roles (Supervisor and
// Administration). Both have NO profile table — they are just a `users` row
// — so add/edit/archive go through the generic account endpoints
// (createAccount / updateAccount / deleteAccount). Archive routes through the
// employee archive (deleteAccount snapshots the users row when the archive
// feature is on); admins additionally get backend self/last-admin guards.
//
// Note: returning-employee (previous_archive_id) linking is intentionally
// NOT offered here — supervisors/admins have no profile table to store the
// link. The "previously deactivated" reactivation prompt below still covers
// the common returning-staff case (account deactivated, not hard-archived).

interface Account {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  // HR fields (migration 024)
  emergencyContact?: string | null;
  address?: string | null;
  hireDate?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  maritalStatus?: string | null;
  gender?: string | null;
  employmentType?: string | null;
  qualifications?: string | null;
  notes?: string | null;
  officialPhoto?: string | null;
}
interface InactiveUser { id: string; firstName: string; lastName: string; username: string; role: string; }

interface Props {
  role: 'supervisor' | 'admin' | 'reception' | 'accountant';
  /** Singular noun, e.g. "Supervisor" / "Administrator". */
  singular: string;
}

type AddForm = { firstName: string; lastName: string; phone: string; email: string; emergencyContact: string; username: string; password: string } & EmployeeHRFormFields;
type EditForm = { firstName: string; lastName: string; phone: string; email: string; emergencyContact: string } & EmployeeHRFormFields;

export default function AccountEmployeesTab({ role, singular }: Props) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Two-phase Add: after "Add" the record is created (committed) and we hold
  // its id so the professional photo can be attached in place; the button
  // becomes "Save". The employee exists whether or not Save is ever clicked.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const addForm = useForm<AddForm>();
  const editForm = useForm<EditForm>();

  const watchedFirst = addForm.watch('firstName');
  const watchedLast = addForm.watch('lastName');
  const debouncedName = useDebounce(`${watchedFirst ?? ''} ${watchedLast ?? ''}`.trim(), 350);
  const [inactiveMatches, setInactiveMatches] = useState<InactiveUser[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = () => {
    adminApi.getAccounts()
      .then(r => setAccounts(((r.data || []) as Account[]).filter(a => a.role === role && a.isActive)))
      .catch(() => {});
  };
  useEffect(() => { load(); }, [role]);

  useEffect(() => {
    const name = (debouncedName ?? '').trim();
    if (name.length < 2) { setInactiveMatches([]); return; }
    adminApi.searchInactiveUsers(name, role)
      .then(r => setInactiveMatches((r.data ?? []) as InactiveUser[]))
      .catch(() => setInactiveMatches([]));
  }, [debouncedName, role]);

  const reactivateInactive = async (u: InactiveUser) => {
    if (!confirm(t('admin.acct_emp.confirm_reactivate', { name: `${u.firstName} ${u.lastName}`, username: u.username }))) return;
    const newPassword = prompt(t('admin.acct_emp.set_password_prompt') + '\n\n' + PASSWORD_POLICY_MESSAGE, '');
    if (newPassword === null) return; // cancelled
    const trimmed = newPassword.trim();
    if (trimmed && !isStrongPassword(trimmed)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setReactivatingId(u.id);
    try {
      const r = await adminApi.reactivateUser(u.id, trimmed || undefined);
      const tail = r.data?.passwordReset ? ' ' + t('admin.acct_emp.new_password_tail', { password: newPassword }) : '';
      toast.success(t('admin.acct_emp.reactivated', { role: singular, username: u.username }) + tail, { autoClose: 8000 });
      addForm.reset();
      setInactiveMatches([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('admin.acct_emp.failed_reactivate'));
    } finally { setReactivatingId(null); }
  };

  const selected = useMemo(() => accounts.find(a => a.id === selectedId) || null, [accounts, selectedId]);

  useEffect(() => {
    if (!selected) return;
    editForm.setValue('firstName', selected.firstName || '');
    editForm.setValue('lastName', selected.lastName || '');
    editForm.setValue('phone', selected.phone || '');
    editForm.setValue('email', selected.email || '');
    editForm.setValue('emergencyContact', selected.emergencyContact || '');
    editForm.setValue('address', selected.address || '');
    editForm.setValue('hireDate', selected.hireDate || '');
    editForm.setValue('nationalId', selected.nationalId || '');
    editForm.setValue('dateOfBirth', selected.dateOfBirth || '');
    editForm.setValue('maritalStatus', selected.maritalStatus || '');
    editForm.setValue('gender', selected.gender || '');
    editForm.setValue('employmentType', selected.employmentType || '');
    editForm.setValue('qualifications', selected.qualifications || '');
    editForm.setValue('notes', selected.notes || '');
  }, [selected]);

  const onAdd = async (data: any) => {
    if (!data.username?.trim() || !data.password?.trim()) {
      toast.error(t('admin.acct_emp.username_password_required'));
      return;
    }
    if (!isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await adminApi.createAccount({
        ...hrPayload(data),
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        emergencyContact: data.emergencyContact || undefined,
        username: data.username,
        password: data.password,
        role,
      });
      toast.success(t('admin.acct_emp.added', { role: singular, username: data.username }), { autoClose: 8000 });
      // Enter the photo phase — record is committed; keep the form filled so
      // the admin can attach a photo and/or tweak details, then Save.
      setCreatedId(res.data?.id ?? null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.acct_emp.failed_add', { role: singular }));
    } finally {
      setAddSubmitting(false);
    }
  };

  // Save phase: persist any edits to the just-created record (works with or
  // without a photo — the photo uploads on its own when picked), then reset
  // back to a blank Add form for the next employee.
  const onSave = async (data: any) => {
    if (!createdId) return;
    setAddSubmitting(true);
    try {
      await adminApi.updateAccount(createdId, {
        ...hrPayload(data),
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        email: data.email || null,
        emergencyContact: data.emergencyContact || null,
      });
      toast.success(t('admin.acct_emp.saved', { role: singular }));
      addForm.reset();
      setCreatedId(null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.acct_emp.failed_save', { role: singular }));
    } finally {
      setAddSubmitting(false);
    }
  };

  const onEdit = async (data: any) => {
    if (!selectedId) { toast.error(t('admin.acct_emp.select_first', { role: singular })); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateAccount(selectedId, {
        ...hrPayload(data),
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        email: data.email || null,
        emergencyContact: data.emergencyContact || null,
      });
      toast.success(t('admin.acct_emp.updated', { role: singular }));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.acct_emp.failed_update', { role: singular }));
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedId) { toast.error(t('admin.acct_emp.select_first', { role: singular })); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.deleteAccount(selectedId, { reason, departureDate });
      toast.success(t('admin.acct_emp.removed', { role: singular }));
      setRemoveOpen(false);
      setSelectedId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.acct_emp.failed_remove', { role: singular }));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Add — full width, two-phase (Add → attach photo → Save) */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('admin.acct_emp.add_title', { role: singular })}</h2>
          <form onSubmit={addForm.handleSubmit(createdId ? onSave : onAdd)} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.first_name')}</label>
                <Input placeholder={t('admin.acct_emp.first_name')} {...addForm.register('firstName', { required: true })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.last_name')}</label>
                <Input placeholder={t('admin.acct_emp.last_name')} {...addForm.register('lastName', { required: true })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.phone')}</label>
                <Input placeholder={t('admin.acct_emp.phone')} {...addForm.register('phone')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.emergency_contact')}</label>
                <Input placeholder={t('admin.acct_emp.emergency_contact')} {...addForm.register('emergencyContact')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.email_optional')}</label>
                <Input placeholder={t('admin.acct_emp.email_optional')} {...addForm.register('email')} />
              </div>
              {!createdId && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.username')}</label>
                    <Input placeholder={t('admin.acct_emp.username')} {...addForm.register('username', { required: true })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.password')}</label>
                    <Input type="password" placeholder={t('admin.acct_emp.password_ph')} {...addForm.register('password', { required: true })} />
                  </div>
                </>
              )}
            </div>
            {!createdId && inactiveMatches.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-amber-900 font-medium mb-2">
                  <History className="w-4 h-4" /> {t('admin.acct_emp.deactivated_matches', { count: inactiveMatches.length })}
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
                      <div className="text-xs text-gray-600">{u.username} · {t('admin.acct_emp.click_reactivate')}</div>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-amber-700 mt-2">{t('admin.acct_emp.returning_hint', { role: singular })}</div>
              </div>
            )}
            <EmployeeHRFields register={addForm.register} />
            {createdId && (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
                  {t('admin.acct_emp.photo_phase_hint', { role: singular })}
                </div>
                <ProfessionalPhotoField
                  role={role}
                  employeeId={createdId}
                  currentUrl={null}
                  onUploaded={() => load()}
                />
              </>
            )}
            <Button type="submit" loading={addSubmitting} fullWidth>{createdId ? t('admin.acct_emp.save') : t('admin.acct_emp.add')}</Button>
          </form>
        </Card>

        {/* Edit — full width, stacked below Add */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">{t('admin.acct_emp.edit_title', { role: singular })}</h2>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
              <Select
                label={t('admin.acct_emp.select_role', { role: singular })}
                options={accounts.map(a => ({ value: a.id, label: `${a.firstName} ${a.lastName}`.trim() || a.username }))}
                placeholder={t('admin.acct_emp.select_role', { role: singular })}
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder={t('admin.acct_emp.first_name')} {...editForm.register('firstName')} />
                <Input placeholder={t('admin.acct_emp.last_name')} {...editForm.register('lastName')} />
              </div>
              <Input placeholder={t('admin.acct_emp.phone')} {...editForm.register('phone')} />
              <Input placeholder={t('admin.acct_emp.emergency_contact')} {...editForm.register('emergencyContact')} />
              <Input placeholder={t('admin.acct_emp.email')} {...editForm.register('email')} />
              {selected && <EmployeeHRFields register={editForm.register} />}
              {selected && (
                <ProfessionalPhotoField
                  role={role}
                  employeeId={selected.id}
                  currentUrl={selected.officialPhoto ?? null}
                  onUploaded={() => load()}
                />
              )}
              {selected && (
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-xs font-medium text-gray-500 mb-0.5">{t('admin.acct_emp.login')}</p>
                  <p className="text-sm text-gray-800">{selected.username}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('admin.acct_emp.reset_hint')}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedId}>{t('admin.acct_emp.update_title', { role: singular })}</Button>
                <Button type="button" variant="danger" loading={removing} onClick={onRemove} disabled={!selectedId}>{t('admin.acct_emp.remove')}</Button>
              </div>
            </form>
          </Card>
      </div>
      <ArchiveReasonModal
        isOpen={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={doRemove}
        busy={removing}
        entityLabel={singular}
      />
    </>
  );
}
