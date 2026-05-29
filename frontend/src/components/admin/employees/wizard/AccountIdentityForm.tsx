// Section 1 (Identity) of the NewEmployeeWizard for the four "account" roles
// (supervisor, accountant, reception, admin). They all hit /admin/accounts
// with the same payload shape, just differing by `role`. Username and
// password are required — accounts must be able to log in immediately.
//
// Unlike Teacher and Staff, account roles have no profile table to anchor
// returning-employee linking onto, so ReturningEmployeeSearch is omitted
// here. The Phase 4 list will still surface deactivated accounts via the
// reactivate flow.

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { adminApi } from '../../../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../../../utils/passwordPolicy';
import Input from '../../../common/Input';
import Button from '../../../common/Button';
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../../EmployeeHRFields';
import type { CreatedEmployee } from './TeacherIdentityForm';

export type AccountRole = 'supervisor' | 'accountant' | 'reception' | 'admin';

type FormFields = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  emergencyContact: string;
  username: string;
  password: string;
} & EmployeeHRFormFields;

interface Props {
  role: AccountRole;
  onCreated: (e: CreatedEmployee) => void;
}

export default function AccountIdentityForm({ role, onCreated }: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormFields>();

  const onSubmit = async (data: FormFields) => {
    if (!data.username?.trim() || !data.password?.trim()) {
      toast.error(t('admin.acct_emp.username_password_required'));
      return;
    }
    if (!isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setSubmitting(true);
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
      const created: CreatedEmployee = {
        id: res.data?.id,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        username: data.username,
      };
      toast.success(t('admin.wizard.identity_saved', 'Employee created. Add optional details below.'));
      onCreated(created);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.wizard.failed_create_account', 'Failed to create employee'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.acct_emp.first_name')} <span className="text-rose-600">*</span>
          </label>
          <Input placeholder={t('admin.acct_emp.first_name')} {...form.register('firstName', { required: true })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.acct_emp.last_name')} <span className="text-rose-600">*</span>
          </label>
          <Input placeholder={t('admin.acct_emp.last_name')} {...form.register('lastName', { required: true })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.phone')}</label>
          <Input placeholder={t('admin.acct_emp.phone')} {...form.register('phone')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.email_optional')}</label>
          <Input placeholder={t('admin.acct_emp.email_optional')} {...form.register('email')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.acct_emp.emergency_contact')}</label>
          <Input placeholder={t('admin.acct_emp.emergency_contact')} {...form.register('emergencyContact')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.acct_emp.username')} <span className="text-rose-600">*</span>
          </label>
          <Input placeholder={t('admin.acct_emp.username')} {...form.register('username', { required: true })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.acct_emp.password')} <span className="text-rose-600">*</span>
          </label>
          <Input type="password" placeholder={t('admin.acct_emp.password_ph')} {...form.register('password', { required: true })} />
        </div>
      </div>

      <EmployeeHRFields register={form.register} />

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={submitting}>
          {t('admin.wizard.add_employee', 'Add Employee')}
        </Button>
      </div>
    </form>
  );
}
