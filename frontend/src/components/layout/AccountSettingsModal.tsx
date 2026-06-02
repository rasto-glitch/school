import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Globe, Mail, Lock } from 'lucide-react';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy';
import Modal from '../common/Modal';
import Input from '../common/Input';
import Button from '../common/Button';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PwForm = { currentPassword: string; newPassword: string; confirmPassword: string };

export default function AccountSettingsModal({ isOpen, onClose }: AccountSettingsModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const [changing, setChanging] = useState(false);
  const { register, handleSubmit, reset } = useForm<PwForm>();

  const onChangePassword = async (data: PwForm) => {
    if (!isStrongPassword(data.newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (data.newPassword !== data.confirmPassword) {
      toast.error(t('profile.passwords_no_match'));
      return;
    }
    setChanging(true);
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      toast.success(t('profile.password_changed'));
      reset();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('profile.password_change_failed'));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('account_settings.title', 'Account Settings')} size="lg">
      <div className="space-y-6">
        {/* Language & region */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.language_section', 'Language & region')}
            </h3>
          </div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('account_settings.display_language', 'Display language')}
          </label>
          <select
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 cursor-pointer"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="ku">کوردی</option>
          </select>
        </section>

        {/* Account email */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('account_settings.email_section', 'Account email')}
            </h3>
          </div>
          <Input
            label={t('account_settings.email_label', 'Email')}
            value={user?.email || ''}
            disabled
            readOnly
          />
          <p className="mt-1.5 text-xs text-gray-500">
            {t('account_settings.email_readonly_hint', 'Contact your school admin to change your account email.')}
          </p>
        </section>

        {/* Password */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-[18px] h-[18px] text-primary-600" />
            <h3 className="font-semibold text-gray-900 text-[15px]">
              {t('profile.change_password', 'Change Password')}
            </h3>
          </div>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3">
            <Input
              type="password"
              label={t('profile.current_password', 'Current Password')}
              autoComplete="current-password"
              {...register('currentPassword', { required: true })}
            />
            <Input
              type="password"
              label={t('profile.new_password', 'New Password')}
              placeholder={t('profile.new_password_ph', 'Min 8 chars, 1 uppercase, 1 special character')}
              autoComplete="new-password"
              {...register('newPassword', { required: true })}
            />
            <Input
              type="password"
              label={t('profile.confirm_password', 'Confirm New Password')}
              autoComplete="new-password"
              {...register('confirmPassword', { required: true })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common.close', 'Close')}
              </Button>
              <Button type="submit" loading={changing}>
                {t('profile.update_password', 'Update Password')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </Modal>
  );
}
