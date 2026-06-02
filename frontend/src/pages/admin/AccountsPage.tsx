import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { toast } from 'react-toastify';
import { UserPlus, Search, Trash2, KeyRound, Clock, CheckCircle2, X, Pencil, Shield, ShieldOff, ExternalLink, Printer } from 'lucide-react';
import { adminApi, mfaApi } from '../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
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

  // Admin emergency MFA disable. Reason is required + audited server-side.
  const [mfaDisableUser, setMfaDisableUser] = useState<any | null>(null);
  const [mfaDisableReason, setMfaDisableReason] = useState('');
  const [mfaDisabling, setMfaDisabling] = useState(false);

  const onConfirmMfaDisable = async () => {
    if (!mfaDisableUser) return;
    if (mfaDisableReason.trim().length < 4) {
      toast.error(t('admin.accounts.mfa_reason_required', 'A short reason is required.'));
      return;
    }
    setMfaDisabling(true);
    try {
      await mfaApi.adminDisable(mfaDisableUser.id, mfaDisableReason.trim());
      toast.success(t('admin.accounts.mfa_disable_success', 'Two-factor disabled for {{name}}.', { name: mfaDisableUser.fullName || mfaDisableUser.firstName || mfaDisableUser.username }));
      setMfaDisableUser(null);
      setMfaDisableReason('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.mfa_disable_failed', 'Could not disable two-factor.'));
    } finally {
      setMfaDisabling(false);
    }
  };

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
      toast.error(t('admin.accounts.pick_class_first')); return;
    }
    if (credRole === 'parent' && credParentScope === 'individual' && !credParentId) {
      toast.error(t('admin.accounts.pick_parent_first')); return;
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
      toast.error(err.response?.data?.error || t('admin.accounts.failed_download_pdf'));
    } finally {
      setCredBusy(false);
    }
  };

  const onSubmit = async (data: any) => {
    if (!isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      await adminApi.createAccount(data);
      toast.success(t('admin.accounts.account_created', { name: `${data.firstName} ${data.lastName}` }));
      reset();
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.failed_create'));
    } finally {
      setLoading(false);
    }
  };

  const onDeleteParent = async (parent: any) => {
    if (!confirm(t('admin.accounts.confirm_delete_parent', { name: parent.fullName }))) return;
    setDeletingId(parent.id);
    try {
      await adminApi.deleteParent(parent.id);
      toast.success(t('admin.accounts.parent_deleted', { name: parent.fullName }));
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.failed_delete_parent'));
    } finally {
      setDeletingId(null);
    }
  };

  const onDeleteAccount = async (acc: any) => {
    const name = displayName(acc);
    if (!confirm(t('admin.accounts.confirm_delete_account', { name }))) return;
    setDeletingId(acc.id);
    try {
      await adminApi.deleteAccount(acc.id);
      toast.success(t('admin.accounts.account_deleted', { name }));
      loadAccounts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.failed_delete_account'));
    } finally {
      setDeletingId(null);
    }
  };

  const openResetModal = (user: any) => {
    setResetModalUser(user);
    setNewPassword('');
  };

  const onResetPassword = async () => {
    if (!isStrongPassword(newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    const userId = resetModalUser?.userId ?? resetModalUser?.id;
    if (!userId) {
      toast.error(t('admin.accounts.user_not_found'));
      return;
    }
    setResetting(true);
    try {
      await adminApi.resetUserPassword(userId, newPassword);
      toast.success(t('admin.accounts.password_reset_for', { name: resetModalUser.fullName ?? resetModalUser.firstName }));
      setResetModalUser(null);
      loadResetRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.failed_reset'));
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
      toast.success(t('admin.accounts.account_updated'));
      setEditUser(null);
      loadAccounts();
      loadParents();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.accounts.failed_update'));
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
    <PageLayout title={t('admin.accounts.title')} subtitle={t('admin.accounts.subtitle')}>
      <div className="space-y-8 max-w-3xl">
        {/* Password Reset Requests */}
        {resetRequests.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-amber-500" />
              <h2 className="font-semibold text-gray-900">{t('admin.accounts.reset_requests')}</h2>
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
                    {t('admin.accounts.set_password')}
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
            <h2 className="font-semibold text-gray-900">{t('admin.accounts.create_account')}</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Select
              label={t('admin.accounts.role')}
              options={[
                { value: 'parent', label: t('admin.accounts.role_parent') },
                { value: 'teacher', label: t('admin.accounts.role_teacher') },
                { value: 'driver', label: t('admin.accounts.role_driver') },
                { value: 'supervisor', label: t('admin.accounts.role_supervisor') },
              ]}
              placeholder={t('admin.accounts.select_role')}
              {...register('role', { required: true })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('admin.accounts.first_name')} placeholder={t('admin.accounts.first_name_ph')} {...register('firstName', { required: true })} />
              <Input label={t('admin.accounts.last_name')} placeholder={t('admin.accounts.last_name_ph')} {...register('lastName', { required: true })} />
            </div>
            <Input label={t('admin.accounts.email')} type="email" placeholder="email@example.com" {...register('email')} />
            <Input label={t('admin.accounts.phone')} placeholder={t('admin.accounts.phone_ph')} {...register('phone')} />
            <Input label={t('admin.accounts.username')} placeholder={t('admin.accounts.username_ph')} {...register('username', { required: true })} />
            <Input label={t('admin.accounts.password')} type="password" placeholder={t('admin.accounts.password_ph')} {...register('password', { required: true })} />
            <Button type="submit" loading={loading} fullWidth icon={<UserPlus className="w-4 h-4" />}>{t('admin.accounts.create_account')}</Button>
          </form>
        </Card>

        {/* Print Credentials */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Printer className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">{t('admin.accounts.print_credentials')}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {t('admin.accounts.print_credentials_hint')}
          </p>
          <div className="space-y-3">
            <Select
              label={t('admin.accounts.role')}
              options={[
                { value: 'teacher', label: t('admin.accounts.all_teachers') },
                { value: 'driver', label: t('admin.accounts.all_drivers') },
                { value: 'parent', label: t('admin.accounts.parents') },
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
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        credParentScope === s
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s === 'all' ? t('admin.accounts.all_parents') : s === 'class' ? t('admin.accounts.by_class') : t('admin.accounts.individual')}
                    </button>
                  ))}
                </div>

                {credParentScope === 'class' && (
                  <Select
                    label={t('admin.accounts.class')}
                    placeholder={t('admin.accounts.select_class')}
                    options={classes.map(c => ({ value: c.id, label: c.name }))}
                    value={credClassId}
                    onChange={e => setCredClassId(e.target.value)}
                  />
                )}

                {credParentScope === 'individual' && (
                  <Select
                    label={t('admin.accounts.parent')}
                    placeholder={t('admin.accounts.select_parent')}
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
              {t('admin.accounts.download_credentials_pdf')}
            </Button>
          </div>
        </Card>

        {/* All Accounts */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">{t('admin.accounts.all_accounts')}</h2>
            <span className="ml-auto text-xs text-gray-400">{t('admin.accounts.shown_count', { count: filteredAccounts.length })}</span>
          </div>

          {/* Search + role filters */}
          <div className="space-y-3 mb-4">
            <Input
              placeholder={t('admin.accounts.search_ph')}
              icon={<Search className="w-4 h-4" />}
              value={accountSearch}
              onChange={e => setAccountSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {ROLE_FILTERS.map(r => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    roleFilter === r
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t(`admin.accounts.role_${r}`)}
                </button>
              ))}
            </div>
          </div>

          {filteredAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t('admin.accounts.no_accounts')}</p>
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
                          <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">{t('admin.accounts.inactive')}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[acc.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t(`admin.accounts.role_${acc.role}`)}
                        </span>
                        <p className="text-xs text-gray-500">@{acc.username}</p>
                        {acc.email && <p className="text-xs text-gray-400 truncate hidden sm:block">{acc.email}</p>}
                      </div>
                    </div>
                    <button
                      onClick={() => openEditModal(acc)}
                      className="text-gray-400 hover:text-primary-600 transition-colors p-1.5 rounded-lg hover:bg-primary-50"
                      title={t('admin.accounts.edit_account_title')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openResetModal(acc)}
                      className="text-gray-400 hover:text-amber-600 transition-colors p-1.5 rounded-lg hover:bg-amber-50"
                      title={t('admin.accounts.reset_password')}
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    {(acc.role === 'admin' || acc.role === 'accountant') && (
                      <button
                        onClick={() => { setMfaDisableUser(acc); setMfaDisableReason(''); }}
                        className="text-gray-400 hover:text-red-600 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                        title={t('admin.accounts.mfa_disable_title', 'Disable two-factor (emergency)')}
                      >
                        <ShieldOff className="w-4 h-4" />
                      </button>
                    )}
                    {isParent && parent && (
                      <button
                        onClick={() => navigate(`/admin/parents/${parent.id}`)}
                        className="text-gray-400 hover:text-primary-600 transition-colors p-1.5 rounded-lg hover:bg-primary-50"
                        title={t('admin.accounts.view_parent_profile')}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                    {isParent && parent ? (
                      <button
                        onClick={() => onDeleteParent(parent)}
                        disabled={deletingId === parent.id}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                        title={t('admin.accounts.delete_parent_title')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (acc.role === 'teacher' || acc.role === 'supervisor' || acc.role === 'reception' || acc.role === 'accountant') ? (
                      <button
                        onClick={() => onDeleteAccount(acc)}
                        disabled={deletingId === acc.id}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                        title={t('admin.accounts.delete_role_title', { role: t(`admin.accounts.role_${acc.role}`) })}
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
          title={t('admin.accounts.reset_modal_title', { name: displayName(resetModalUser) })}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              <Trans i18nKey="admin.accounts.reset_modal_hint" values={{ username: resetModalUser.username }} components={{ b: <span className="font-medium text-gray-700" /> }} />
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.new_password')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('admin.accounts.password_ph')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => setResetModalUser(null)} icon={<X className="w-4 h-4" />}>
                {t('common.cancel')}
              </Button>
              <Button fullWidth loading={resetting} onClick={onResetPassword} icon={<CheckCircle2 className="w-4 h-4" />}>
                {t('admin.accounts.set_password')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MFA Disable Modal — admin emergency disable for a user who's
          locked out (lost phone + lost recovery codes). Audited. */}
      {mfaDisableUser && (
        <Modal
          isOpen={true}
          onClose={() => { setMfaDisableUser(null); setMfaDisableReason(''); }}
          title={t('admin.accounts.mfa_disable_modal_title', { name: mfaDisableUser.fullName || mfaDisableUser.firstName || mfaDisableUser.username })}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-900">
                {t('admin.accounts.mfa_disable_warning', "This turns off two-factor authentication for this user. They will be able to sign in with just their password. Use this only when the user has lost both their authenticator and their recovery codes. The action is logged with your name and reason.")}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.mfa_disable_reason_label', 'Reason')}</label>
              <input
                type="text"
                value={mfaDisableReason}
                onChange={e => setMfaDisableReason(e.target.value)}
                placeholder={t('admin.accounts.mfa_disable_reason_ph', 'e.g. lost phone, in person verified')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
                maxLength={500}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => { setMfaDisableUser(null); setMfaDisableReason(''); }} icon={<X className="w-4 h-4" />}>
                {t('common.cancel')}
              </Button>
              <Button
                fullWidth
                loading={mfaDisabling}
                onClick={onConfirmMfaDisable}
                icon={<ShieldOff className="w-4 h-4" />}
                className="bg-red-600 hover:bg-red-700"
              >
                {t('admin.accounts.mfa_disable_action', 'Disable two-factor')}
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
          title={t('admin.accounts.edit_modal_title', { name: displayName(editUser) })}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.first_name')}</label>
                <input
                  type="text"
                  value={editForm.firstName}
                  onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.last_name')}</label>
                <input
                  type="text"
                  value={editForm.lastName}
                  onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.username')}</label>
              <input
                type="text"
                value={editForm.username}
                onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.email')}</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('admin.accounts.phone')}</label>
              <input
                type="text"
                value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex items-center gap-3 py-1">
              <label className="text-sm font-medium text-gray-700">{t('admin.accounts.active')}</label>
              <button
                type="button"
                onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editForm.isActive ? 'bg-primary-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editForm.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-gray-500">{editForm.isActive ? t('admin.accounts.active') : t('admin.accounts.inactive_label')}</span>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => setEditUser(null)} icon={<X className="w-4 h-4" />}>
                {t('common.cancel')}
              </Button>
              <Button fullWidth loading={saving} onClick={onSaveEdit} icon={<CheckCircle2 className="w-4 h-4" />}>
                {t('admin.accounts.save_changes')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageLayout>
  );
}
