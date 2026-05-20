import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, User, Phone, Mail, Home, KeyRound, Pencil, CheckCircle2, X, Calendar, GraduationCap } from 'lucide-react';
import { toast } from 'react-toastify';
import { adminApi } from '../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { format, parseISO } from 'date-fns';

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function ParentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);

  // Username edit state
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // Password reset state
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    adminApi.getParentProfile(id)
      .then(r => setProfile(r.data))
      .catch(() => toast.error('Failed to load parent profile'))
      .finally(() => setLoading(false));
  }, [id]);

  const parent = profile?.parent;
  const appointments = profile?.appointments || [];

  const onSaveUsername = async () => {
    if (!usernameInput.trim()) return;
    const userId = parent?.users?.id;
    if (!userId) return;
    setSavingUsername(true);
    try {
      await adminApi.updateAccount(userId, { username: usernameInput.trim() });
      toast.success('Username updated');
      setProfile((p: any) => ({
        ...p,
        parent: { ...p.parent, users: { ...p.parent.users, username: usernameInput.trim() } },
      }));
      setEditingUsername(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update username');
    } finally {
      setSavingUsername(false);
    }
  };

  const onResetPassword = async () => {
    if (!isStrongPassword(newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    const userId = parent?.users?.id;
    if (!userId) return;
    setResettingPassword(true);
    try {
      await adminApi.resetUserPassword(userId, newPassword);
      toast.success('Password reset successfully');
      setNewPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <PageLayout title="Parent Profile" subtitle="Full profile and account management">
      <div className="max-w-3xl space-y-6">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {loading && <LoadingSpinner />}

        {!loading && parent && (
          <>
            {/* Profile card */}
            <Card>
              <div className="flex items-start gap-5">
                <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl font-bold text-primary-700">
                    {(parent.fullName || '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs font-semibold text-gray-400 uppercase block">Full Name</span>
                    <span className="text-gray-900 font-medium">{parent.fullName || '—'}</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-xs font-semibold text-gray-400 uppercase block">Phone</span>
                      <span className="text-gray-900 font-medium">{parent.phoneNumber || '—'}</span>
                    </div>
                  </div>
                  {parent.email && (
                    <div className="flex items-start gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-xs font-semibold text-gray-400 uppercase block">Email</span>
                        <span className="text-gray-900 font-medium">{parent.email}</span>
                      </div>
                    </div>
                  )}
                  {parent.residenceType && (
                    <div className="flex items-start gap-1.5">
                      <Home className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-xs font-semibold text-gray-400 uppercase block">Residence</span>
                        <span className="text-gray-900 font-medium capitalize">{parent.residenceType}</span>
                      </div>
                    </div>
                  )}
                  {parent.blockNumber && (
                    <div>
                      <span className="text-xs font-semibold text-gray-400 uppercase block">Block</span>
                      <span className="text-gray-900 font-medium">{parent.blockNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Account management */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Account</h2>
                {parent.users?.isActive === false && (
                  <span className="ml-auto text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">inactive</span>
                )}
              </div>

              {/* Username */}
              <div className="mb-5">
                <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Username</label>
                {editingUsername ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={e => setUsernameInput(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') onSaveUsername(); if (e.key === 'Escape') setEditingUsername(false); }}
                    />
                    <Button loading={savingUsername} onClick={onSaveUsername} icon={<CheckCircle2 className="w-4 h-4" />}>
                      Save
                    </Button>
                    <Button variant="outline" onClick={() => setEditingUsername(false)} icon={<X className="w-4 h-4" />}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-900 font-medium">@{parent.users?.username || '—'}</span>
                    <button
                      onClick={() => { setUsernameInput(parent.users?.username || ''); setEditingUsername(true); }}
                      className="text-gray-400 hover:text-primary-600 transition-colors p-1 rounded-lg hover:bg-primary-50"
                      title="Edit username"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Reset password */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">
                  <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                  Reset Password
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, 1 uppercase, 1 special character"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    onKeyDown={e => { if (e.key === 'Enter') onResetPassword(); }}
                  />
                  <Button loading={resettingPassword} onClick={onResetPassword} icon={<KeyRound className="w-4 h-4" />}>
                    Set
                  </Button>
                </div>
              </div>
            </Card>

            {/* Children */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Children</h2>
                <span className="ml-auto text-xs text-gray-400">{parent.students?.length ?? 0}</span>
              </div>
              {!parent.students?.length ? (
                <p className="text-sm text-gray-400 text-center py-3">No linked children.</p>
              ) : (
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
                  {parent.students.map((child: any) => (
                    <Link
                      key={child.id}
                      to={`/admin/student-brief?id=${child.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-primary-50 transition-colors"
                    >
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-primary-700 font-bold text-xs">{(child.fullName || '?')[0]}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{child.fullName}</p>
                        {child.classes?.name && (
                          <p className="text-xs text-gray-500">{child.classes.name}</p>
                        )}
                      </div>
                      <span className="text-xs text-primary-600 font-medium">View Brief →</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Appointments */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Appointments</h2>
                <span className="ml-auto text-xs text-gray-400">{appointments.length}</span>
              </div>
              {appointments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">No appointments.</p>
              ) : (
                <div className="space-y-3">
                  {appointments.map((appt: any) => (
                    <div key={appt.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-gray-900 capitalize">{appt.reason || 'Appointment'}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${STATUS_STYLES[appt.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {appt.status}
                        </span>
                      </div>
                      {appt.message && <p className="text-sm text-gray-600 mb-2">{appt.message}</p>}
                      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                        {appt.requestedDate && (
                          <span>Requested: {format(parseISO(appt.requestedDate), 'MMM d, yyyy')}</span>
                        )}
                        {appt.scheduledDate && (
                          <span>Scheduled: {format(parseISO(appt.scheduledDate), 'MMM d, yyyy')}</span>
                        )}
                        <span>Submitted: {format(parseISO(appt.createdAt), 'MMM d, yyyy')}</span>
                      </div>
                      {appt.responseMessage && (
                        <div className="mt-2 bg-gray-50 rounded-lg p-2">
                          <p className="text-xs font-semibold text-gray-400 uppercase mb-0.5">Response</p>
                          <p className="text-sm text-gray-700">{appt.responseMessage}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
