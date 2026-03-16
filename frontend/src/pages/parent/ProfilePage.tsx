import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { User, Lock } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [changing, setChanging] = useState(false);

  const { register, handleSubmit, reset } = useForm<{
    currentPassword: string; newPassword: string; confirmPassword: string;
  }>();

  const onChangePassword = async (data: any) => {
    if (data.newPassword !== data.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setChanging(true);
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      toast.success('Password changed successfully!');
      reset();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    } finally {
      setChanging(false);
    }
  };

  return (
    <PageLayout title={t('profile.title')} subtitle={t('profile.subtitle')}>
      <div className="max-w-xl space-y-6">
        {/* User info */}
        <Card>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
              {user?.profilePicture ? (
                <img src={user.profilePicture} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-primary-600" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
              <p className="text-gray-500 text-sm capitalize">{user?.role}</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4 py-2 border-b border-gray-50">
              <span className="text-gray-500 flex-shrink-0">Username</span>
              <span className="font-medium text-gray-900 truncate">{user?.username}</span>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <span className="text-gray-500 flex-shrink-0">Role</span>
              <span className="font-medium text-gray-900 capitalize">{user?.role}</span>
            </div>
          </div>
        </Card>

        {/* Change Password */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-primary-600" />
            <h3 className="font-semibold text-gray-900">Change Password</h3>
          </div>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-4">
            <Input label="Current Password" type="password" {...register('currentPassword', { required: true })} />
            <Input label="New Password" type="password" {...register('newPassword', { required: true, minLength: 6 })} />
            <Input label="Confirm New Password" type="password" {...register('confirmPassword', { required: true })} />
            <Button type="submit" loading={changing} fullWidth>Update Password</Button>
          </form>
        </Card>
      </div>
    </PageLayout>
  );
}
