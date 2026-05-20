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
}
interface InactiveUser { id: string; firstName: string; lastName: string; username: string; role: string; }

interface Props {
  role: 'supervisor' | 'admin';
  /** Singular noun, e.g. "Supervisor" / "Administrator". */
  singular: string;
}

export default function AccountEmployeesTab({ role, singular }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const addForm = useForm<{ firstName: string; lastName: string; phone: string; email: string; username: string; password: string }>();
  const editForm = useForm<{ firstName: string; lastName: string; phone: string; email: string }>();

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
      toast.success(`${singular} reactivated. Login: ${u.username}.${tail}`, { autoClose: 8000 });
      addForm.reset();
      setInactiveMatches([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reactivate');
    } finally { setReactivatingId(null); }
  };

  const selected = useMemo(() => accounts.find(a => a.id === selectedId) || null, [accounts, selectedId]);

  useEffect(() => {
    if (!selected) return;
    editForm.setValue('firstName', selected.firstName || '');
    editForm.setValue('lastName', selected.lastName || '');
    editForm.setValue('phone', selected.phone || '');
    editForm.setValue('email', selected.email || '');
  }, [selected]);

  const onAdd = async (data: any) => {
    if (!data.username?.trim() || !data.password?.trim()) {
      toast.error('Username and password are required');
      return;
    }
    if (!isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setAddSubmitting(true);
    try {
      await adminApi.createAccount({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        username: data.username,
        password: data.password,
        role,
      });
      toast.success(`${singular} added! Login: ${data.username}`, { autoClose: 8000 });
      addForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Failed to add ${singular.toLowerCase()}`);
    } finally {
      setAddSubmitting(false);
    }
  };

  const onEdit = async (data: any) => {
    if (!selectedId) { toast.error(`Select a ${singular.toLowerCase()} first`); return; }
    setEditSubmitting(true);
    try {
      await adminApi.updateAccount(selectedId, {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        email: data.email || null,
      });
      toast.success(`${singular} updated!`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Failed to update ${singular.toLowerCase()}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const onRemove = () => {
    if (!selectedId) { toast.error(`Select a ${singular.toLowerCase()} first`); return; }
    setRemoveOpen(true);
  };

  const doRemove = async (reason: string, departureDate: string) => {
    setRemoving(true);
    try {
      await adminApi.deleteAccount(selectedId, { reason, departureDate });
      toast.success(`${singular} removed`);
      setRemoveOpen(false);
      setSelectedId('');
      editForm.reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Failed to remove ${singular.toLowerCase()}`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Add */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Add {singular}</h2>
            <form onSubmit={addForm.handleSubmit(onAdd)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="First Name" {...addForm.register('firstName', { required: true })} />
                <Input placeholder="Last Name" {...addForm.register('lastName', { required: true })} />
              </div>
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
                  <div className="text-xs text-amber-700 mt-2">If this is a returning {singular.toLowerCase()}, click their record to reactivate. Otherwise just continue filling in the form for a new one.</div>
                </div>
              )}
              <Input placeholder="Phone Number" {...addForm.register('phone')} />
              <Input placeholder="Email (optional)" {...addForm.register('email')} />
              <Input placeholder="Username" {...addForm.register('username', { required: true })} />
              <Input type="password" placeholder="Min 8 chars, 1 uppercase, 1 special character" {...addForm.register('password', { required: true })} />
              <Button type="submit" loading={addSubmitting} fullWidth>Send</Button>
            </form>
          </Card>

          {/* Edit */}
          <Card>
            <h2 className="font-semibold text-gray-900 mb-4">Edit {singular}</h2>
            <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-3">
              <Select
                label={`Select ${singular}`}
                options={accounts.map(a => ({ value: a.id, label: `${a.firstName} ${a.lastName}`.trim() || a.username }))}
                placeholder={`Select ${singular}`}
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="First Name" {...editForm.register('firstName')} />
                <Input placeholder="Last Name" {...editForm.register('lastName')} />
              </div>
              <Input placeholder="Phone Number" {...editForm.register('phone')} />
              <Input placeholder="Email" {...editForm.register('email')} />
              {selected && (
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Login</p>
                  <p className="text-sm text-gray-800">{selected.username}</p>
                  <p className="text-xs text-gray-400 mt-1">Reset the password from the Accounts page.</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={editSubmitting} fullWidth disabled={!selectedId}>Update {singular}</Button>
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
        entityLabel={singular.toLowerCase()}
      />
    </>
  );
}
