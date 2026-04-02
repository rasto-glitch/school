import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { User, Lock, ImagePlus, Pencil } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, setProfilePicture } = useAuthStore();
  const [changing, setChanging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputId = 'avatar-upload';

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

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return; }
    setUploading(true);
    try {
      const res = await authApi.uploadProfilePicture(file);
      setProfilePicture(res.data.profilePicture);
      toast.success('Profile picture updated!');
    } catch {
      toast.error('Failed to upload picture');
    } finally {
      setUploading(false);
    }
  };

  return (
    <PageLayout title={t('profile.title')} subtitle={t('profile.subtitle')}>
      <div className="max-w-xl space-y-6">
        {/* User info */}
        <Card>
          <div className="flex items-center gap-4 mb-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center">
                {user?.profilePicture
                  ? <img src={user.profilePicture} alt="" className="w-full h-full object-cover" />
                  : <User className="w-8 h-8 text-primary-600" />}
              </div>
              {/* Change badge — only shown when photo already set */}
              {user?.profilePicture && (
                <label
                  htmlFor={inputId}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center cursor-pointer shadow-sm hover:bg-gray-50"
                  title="Change photo"
                >
                  <Pencil className="w-3 h-3 text-gray-600" />
                </label>
              )}
            </div>

            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
              <p className="text-gray-500 text-sm capitalize">{user?.role}</p>
            </div>
          </div>

          {/* Set Profile Picture button — shown when no photo set */}
          {!user?.profilePicture && (
            <label
              htmlFor={inputId}
              className={`flex items-center justify-center gap-2 w-full mb-4 py-2.5 px-4 rounded-xl border-2 border-dashed border-primary-300 text-primary-600 text-sm font-medium cursor-pointer hover:bg-primary-50 transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            >
              {uploading
                ? <span className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                : <ImagePlus className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Set Profile Picture'}
            </label>
          )}

          {/* Loading indicator when replacing existing photo */}
          {user?.profilePicture && uploading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              Uploading…
            </div>
          )}

          {/* Hidden file input — triggered by both labels above */}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
            disabled={uploading}
          />

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
