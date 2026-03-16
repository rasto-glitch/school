import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { UserPlus, Search, Trash2, KeyRound, Clock, CheckCircle2, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';

export default function AccountsPage() {
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, reset } = useForm<{
    firstName: string; lastName: string; email: string; phone: string;
    username: string; password: string; role: string;
  }>();

  const [parents, setParents] = useState<any[]>([]);
  const [parentSearch, setParentSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset requests
  const [resetRequests, setResetRequests] = useState<any[]>([]);
  const [resetModalParent, setResetModalParent] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const loadParents = () => {
    adminApi.getParents().then(r => setParents(r.data || []));
  };

  const loadResetRequests = () => {
    adminApi.getResetRequests().then(r => setResetRequests(r.data || [])).catch(() => {});
  };

  useEffect(() => {
    loadParents();
    loadResetRequests();
  }, []);

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      await adminApi.createAccount(data);
      toast.success(`Account created for ${data.firstName} ${data.lastName}`);
      reset();
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
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete parent');
    } finally {
      setDeletingId(null);
    }
  };

  const openResetModal = (parent: any) => {
    setResetModalParent(parent);
    setNewPassword('');
  };

  const onResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (!resetModalParent?.userId) {
      toast.error('Could not find user account for this parent');
      return;
    }
    setResetting(true);
    try {
      await adminApi.resetUserPassword(resetModalParent.userId, newPassword);
      toast.success(`Password reset for ${resetModalParent.fullName}`);
      setResetModalParent(null);
      loadResetRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const filteredParents = parentSearch.trim()
    ? parents.filter(p => {
        const name = (p.fullName || '').toLowerCase();
        const username = (p.users?.username || '').toLowerCase();
        const q = parentSearch.toLowerCase();
        return name.includes(q) || username.includes(q);
      })
    : parents;

  return (
    <PageLayout title="Accounts Management" subtitle="Create user accounts and manage parent accounts">
      <div className="space-y-8 max-w-2xl">
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
                      // Find matching parent to get userId
                      const parent = parents.find(p => p.users?.username === req.username);
                      if (parent) {
                        openResetModal(parent);
                      } else {
                        // Fallback: open modal with minimal info
                        openResetModal({ fullName: req.fullName || req.username, userId: req.userId, users: { username: req.username } });
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
                { value: 'admin', label: 'Admin' },
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

        {/* Parent Accounts */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">Parent Accounts</h2>
          <div className="mb-3">
            <Input
              placeholder="Search by name or username..."
              icon={<Search className="w-4 h-4" />}
              value={parentSearch}
              onChange={e => setParentSearch(e.target.value)}
            />
          </div>

          {filteredParents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {parentSearch ? 'No parents match your search.' : 'No parent accounts found.'}
            </p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
              {filteredParents.map(p => {
                const children: any[] = p.students || [];
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-700 font-bold text-sm">{(p.fullName || '?')[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.fullName || '(No name)'}</p>
                      <p className="text-xs text-gray-500">@{p.users?.username || '—'}</p>
                      {children.length > 0 && (
                        <p className="text-xs text-gray-400 truncate">
                          {children.map((c: any) => c.fullName).join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => openResetModal(p)}
                      className="text-primary-500 hover:text-primary-700 transition-colors p-1.5 rounded-lg hover:bg-primary-50"
                      title="Reset password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteParent(p)}
                      disabled={deletingId === p.id}
                      className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                      title="Delete parent account"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">Deleting a parent removes their login. Their children remain in the system, unlinked.</p>
        </Card>
      </div>

      {/* Reset Password Modal */}
      {resetModalParent && (
        <Modal
          isOpen={true}
          onClose={() => setResetModalParent(null)}
          title={`Reset Password — ${resetModalParent.fullName}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Set a new password for <span className="font-medium text-gray-700">@{resetModalParent.users?.username}</span>.
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
              <Button
                variant="outline"
                fullWidth
                onClick={() => setResetModalParent(null)}
                icon={<X className="w-4 h-4" />}
              >
                Cancel
              </Button>
              <Button
                fullWidth
                loading={resetting}
                onClick={onResetPassword}
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                Set Password
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageLayout>
  );
}
