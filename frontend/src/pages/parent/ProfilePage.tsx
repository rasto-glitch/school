import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { User, Lock, Camera } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
      // reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <PageLayout title={t('profile.title')} subtitle={t('profile.subtitle')}>
      <div className="max-w-xl space-y-6">
        {/* User info */}
        <Card>
          <div className="flex items-center gap-4 mb-4">
            {/* Clickable avatar */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="relative w-16 h-16 rounded-full group flex-shrink-0 focus:outline-none"
              title="Change profile picture"
            >
              {user?.profilePicture ? (
                <img src={user.profilePicture} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="w-8 h-8 text-primary-600" />
                </div>
              )}
              {/* Hover overlay */}
              <div className={`absolute inset-0 rounded-full flex items-center justify-center transition-opacity
                ${uploading ? 'bg-black/40 opacity-100' : 'bg-black/0 group-hover:bg-black/40 opacity-0 group-hover:opacity-100'}`}>
                {uploading
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Camera className="w-5 h-5 text-white" />}
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarChange}
            />

            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
              <p className="text-gray-500 text-sm capitalize">{user?.role}</p>
              <p className="text-xs text-gray-400 mt-0.5">Click photo to change</p>
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
