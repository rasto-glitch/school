import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { UserPlus, Search, Trash2, KeyRound, Clock, CheckCircle2, X, Pencil, Shield, ExternalLink, Printer } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';

const ROLE_COLORS: Record<string, string> = {
  admin:      'bg-purple-100 text-purple-700',
  teacher:    'bg-blue-100 text-blue-700',
  driver:     'bg-orange-100 text-orange-700',
  supervisor: 'bg-teal-100 text-teal-700',
  parent:     'bg-green-100 text-green-700',
  reception:  'bg-pink-100 text-pink-700',
  accountant: 'bg-amber-100 text-amber-700',
};

const ROLE_FILTERS = ['all', 'parent', 'teacher', 'driver', 'supervisor', 'admin', 'reception', 'accountant'] as const;
type RoleFilter = typeof ROLE_FILTERS[number];

export default function AccountsPage() {
  const navigate = useNavigate();
  const { school } = useAuthStore();
  const isAccountingPremium = school?.features?.tuition_fees === true;
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, reset } = useForm<{
    firstName: string; lastName: string; email: string; phone: string;
    username: string; password: string; role: string;
  }>();

  // All accounts
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  // Parents list (for delete and reset-password)
  const [parents, setParents] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset password modal
  const [resetModalUser, setResetModalUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Reset requests
  const [resetRequests, setResetRequests] = useState<any[]>([]);

  // Credentials PDF export
  const [classes, setClasses] = useState<any[]>([]);
  const [credRole, setCredRole] = useState<'teacher' | 'driver' | 'parent'>('teacher');
  const [credParentScope, setCredParentScope] = useState<'all' | 'class' | 'individual'>('all');
  const [credClassId, setCredClassId] = useState('');
  const [credParentId, setCredParentId] = useState('');
  const [credBusy, setCredBusy] = useState(false);

  // Edit account modal
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', username: '', isActive: true,
  });
  const [saving, setSaving] = useState(false);

  const loadAccounts = () => {
    adminApi.getAccounts().then(r => setAccounts(r.data || [])).catch(() => {});
  };
  const loadParents = () => {
    adminApi.getParents().then(r => setParents(r.data || [])).catch(() => {});
  };
  const loadResetRequests = () => {
    adminApi.getResetRequests().then(r => setResetRequests(r.data || [])).catch(() => {});
  };

  useEffect(() => {
    loadAccounts();
    loadParents();
    loadResetRequests();
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, []);

  const onExportCredentials = async () => {
    if (credRole === 'parent' && credParentScope === 'class' && !credClassId) {
      toast.error('Pick a class first'); return;
    }
    if (credRole === 'parent' && credParentScope === 'individual' && !credParentId) {
      toast.error('Pick a parent first'); return;
    }
    setCredBusy(true);
    try {
      const params: { role: 'parent' | 'teacher' | 'driver'; classId?: string; parentId?: string } = { role: credRole };
      if (credRole === 'parent' && credParentScope === 'class') params.classId = credClassId;
      if (credRole === 'parent' && credParentScope === 'individual') params.parentId = credParentId;
      const res = await adminApi.exportCredentialsPdf(params);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `credentials-${credRole}-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download credentials PDF');
    } finally {
      setCredBusy(false);
    }
  };

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      await adminApi.createAccount(data);
      toast.success(`Account created for ${data.firstName} ${data.lastName}`);
      reset();
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const onDeleteParent = async (parent: any) => {
    if (!confirm(`Delete parent account "${parent.fullName}"?\n\nThis will permanently remove their login and unlink their children. This cannot be undone.`)) return;
    setDeletingId(parent.id);
    try {
      await adminApi.deleteParent(parent.id);
      toast.success(`Parent account "${parent.fullName}" deleted`);
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete parent');
    } finally {
      setDeletingId(null);
    }
  };

  const onDeleteAccount = async (acc: any) => {
    const name = displayName(acc);
    if (!confirm(`Delete account "${name}"?\n\nThis will permanently remove their login. This cannot be undone.`)) return;
    setDeletingId(acc.id);
    try {
      await adminApi.deleteAccount(acc.id);
      toast.success(`Account "${name}" deleted`);
      loadAccounts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete account');
    } finally {
      setDeletingId(null);
    }
  };

  const openResetModal = (user: any) => {
    setResetModalUser(user);
    setNewPassword('');
  };

  const onResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    const userId = resetModalUser?.userId ?? resetModalUser?.id;
    if (!userId) {
      toast.error('Could not find user account');
      return;
    }
    setResetting(true);
    try {
      await adminApi.resetUserPassword(userId, newPassword);
      toast.success(`Password reset for ${resetModalUser.fullName ?? resetModalUser.firstName}`);
      setResetModalUser(null);
      loadResetRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const openEditModal = (acc: any) => {
    setEditUser(acc);
    setEditForm({
      firstName: acc.firstName ?? '',
      lastName: acc.lastName ?? '',
      email: acc.email ?? '',
      phone: acc.phone ?? '',
      username: acc.username ?? '',
      isActive: acc.isActive !== false,
    });
  };

  const onSaveEdit = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      await adminApi.updateAccount(editUser.id, editForm);
      toast.success('Account updated');
      setEditUser(null);
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update account');
    } finally {
      setSaving(false);
    }
  };

  // Filtered accounts list
  const filteredAccounts = accounts.filter(acc => {
    if (roleFilter !== 'all' && acc.role !== roleFilter) return false;
    if (accountSearch.trim()) {
      const q = accountSearch.toLowerCase();
      const name = `${acc.firstName ?? ''} ${acc.lastName ?? ''}`.toLowerCase();
      return name.includes(q) || (acc.username ?? '').toLowerCase().includes(q) || (acc.email ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const displayName = (acc: any) =>
    acc.firstName ? `${acc.firstName} ${acc.lastName ?? ''}`.trim() : acc.username;

  return (
    <PageLayout title="Accounts Management" subtitle="Create and manage all user accounts">
      <div className="space-y-8 max-w-3xl">
        {/* Password Reset Requests */}
        {resetRequests.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-amber-500" />
              <h2 className="font-semibold text-gray-900">Password Reset Requests</h2>
              <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {resetRequests.length}
              </span>
            </div>
            <div className="divide-y divide-gray-100 border border-amber-200 rounded-xl overflow-hidden">
              {resetRequests.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 px-4 py-3 bg-amber-50/50">
                  <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <KeyRound className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{req.fullName || req.username}</p>
                    <p className="text-xs text-gray-500">@{req.username}</p>
                  </div>
                  <button
                    onClick={() => {
                      const acc = accounts.find(a => a.username === req.username);
                      if (acc) {
                        openResetModal(acc);
                      } else {
                        openResetModal({ firstName: req.fullName || req.username, id: req.userId, username: req.username });
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    <KeyRound className="w-3 h-3" />
                    Set Password
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Create Account */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Create Account</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select
              label="Role"
              options={[
                { value: 'parent', label: 'Parent' },
                { value: 'teacher', label: 'Teacher' },
                { value: 'driver', label: 'Driver' },
                { value: 'supervisor', label: 'Supervisor' },
                { value: 'reception', label: 'Reception' },
                { value: 'admin', label: 'Admin' },
                ...(isAccountingPremium ? [{ value: 'accountant', label: 'Accountant' }] : []),
              ]}
              placeholder="Select role"
              {...register('role', { required: true })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="First Name" placeholder="First name" {...register('firstName', { required: true })} />
              <Input label="Last Name" placeholder="Last name" {...register('lastName', { required: true })} />
            </div>
            <Input label="Email" type="email" placeholder="email@example.com" {...register('email')} />
            <Input label="Phone" placeholder="Phone number" {...register('phone')} />
            <Input label="Username" placeholder="Login username" {...register('username', { required: true })} />
            <Input label="Password" type="password" placeholder="Initial password" {...register('password', { required: true })} />
            <Button type="submit" loading={loading} fullWidth icon={<UserPlus className="w-4 h-4" />}>Create Account</Button>
          </form>
        </Card>

        {/* Print Credentials */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Printer className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Print Login Credentials</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Download a printable PDF with usernames and default passwords. The PDF prints 4 cards per A4 page (cut along the dashed lines).
            Passwords shown are the role defaults — if the user has changed theirs, the printed value will not work.
          </p>
          <div className="space-y-3">
            <Select
              label="Role"
              options={[
                { value: 'teacher', label: 'All Teachers' },
                { value: 'driver', label: 'All Drivers' },
                { value: 'parent', label: 'Parents' },
              ]}
              value={credRole}
              onChange={e => { setCredRole(e.target.value as any); setCredClassId(''); setCredParentId(''); }}
            />

            {credRole === 'parent' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'class', 'individual'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setCredParentScope(s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize ${
                        credParentScope === s
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s === 'all' ? 'All Parents' : s === 'class' ? 'By Class' : 'Individual'}
                    </button>
                  ))}
                </div>

                {credParentScope === 'class' && (
                  <Select
                    label="Class"
                    placeholder="Select a class"
                    options={classes.map(c => ({ value: c.id, label: c.name }))}
                    value={credClassId}
                    onChange={e => setCredClassId(e.target.value)}
                  />
                )}

                {credParentScope === 'individual' && (
                  <Select
                    label="Parent"
                    placeholder="Select a parent"
                    options={parents.map(p => ({ value: p.id, label: p.fullName }))}
                    value={credParentId}
                    onChange={e => setCredParentId(e.target.value)}
                  />
                )}
              </>
            )}

            <Button
              fullWidth
              loading={credBusy}
              onClick={onExportCredentials}
              icon={<Printer className="w-4 h-4" />}
            >
              Download Credentials PDF
            </Button>
          </div>
        </Card>

        {/* All Accounts */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">All Accounts</h2>
            <span className="ml-auto text-xs text-gray-400">{filteredAccounts.length} shown</span>
          </div>

          {/* Search + role filters */}
          <div className="space-y-3 mb-4">
            <Input
              placeholder="Search by name, username, or email..."
              icon={<Search className="w-4 h-4" />}
              value={accountSearch}
              onChange={e => setAccountSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {ROLE_FILTERS.map(r => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                    roleFilter === r
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {filteredAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No accounts found.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
              {filteredAccounts.map(acc => {
                const isParent = acc.role === 'parent';
                const parent = isParent ? parents.find(p => p.users?.username === acc.username || p.userId === acc.id) : null;
                const name = displayName(acc);
                return (
                  <div key={acc.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-600 font-bold text-sm">{name[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
                        {!acc.isActive && (
                          <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">inactive</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLORS[acc.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {acc.role}
                        </span>
                        <p className="text-xs text-gray-500">@{acc.username}</p>
                        {acc.email && <p className="text-xs text-gray-400 truncate hidden sm:block">{acc.email}</p>}
                      </div>
                    </div>
                    <button
                      onClick={() => openEditModal(acc)}
                      className="text-gray-400 hover:text-primary-600 transition-colors p-1.5 rounded-lg hover:bg-primary-50"
                      title="Edit account"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openResetModal(acc)}
                      className="text-gray-400 hover:text-amber-600 transition-colors p-1.5 rounded-lg hover:bg-amber-50"
                      title="Reset password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    {isParent && parent && (
                      <button
                        onClick={() => navigate(`/admin/parents/${parent.id}`)}
                        className="text-gray-400 hover:text-primary-600 transition-colors p-1.5 rounded-lg hover:bg-primary-50"
                        title="View parent profile"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                    {isParent && parent ? (
                      <button
                        onClick={() => onDeleteParent(parent)}
                        disabled={deletingId === parent.id}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                        title="Delete parent account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (acc.role === 'teacher' || acc.role === 'supervisor' || acc.role === 'reception' || acc.role === 'accountant') ? (
                      <button
                        onClick={() => onDeleteAccount(acc)}
                        disabled={deletingId === acc.id}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                        title={`Delete ${acc.role} account`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Reset Password Modal */}
      {resetModalUser && (
        <Modal
          isOpen={true}
          onClose={() => setResetModalUser(null)}
          title={`Reset Password — ${displayName(resetModalUser)}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Set a new password for <span className="font-medium text-gray-700">@{resetModalUser.username}</span>.
              Make sure to inform them of their new password.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => setResetModalUser(null)} icon={<X className="w-4 h-4" />}>
                Cancel
              </Button>
              <Button fullWidth loading={resetting} onClick={onResetPassword} icon={<CheckCircle2 className="w-4 h-4" />}>
                Set Password
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Account Modal */}
      {editUser && (
        <Modal
          isOpen={true}
          onClose={() => setEditUser(null)}
          title={`Edit Account — ${displayName(editUser)}`}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  value={editForm.firstName}
                  onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  value={editForm.lastName}
                  onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={editForm.username}
                onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex items-center gap-3 py-1">
              <label className="text-sm font-medium text-gray-700">Active</label>
              <button
                type="button"
                onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editForm.isActive ? 'bg-primary-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editForm.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-gray-500">{editForm.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => setEditUser(null)} icon={<X className="w-4 h-4" />}>
                Cancel
              </Button>
              <Button fullWidth loading={saving} onClick={onSaveEdit} icon={<CheckCircle2 className="w-4 h-4" />}>
                Save Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageLayout>
  );
}
