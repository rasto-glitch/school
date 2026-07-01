// Section 1 (Identity) of the NewEmployeeWizard, staff variant. Hits
// /admin/staff with a placeholder salary of 0 — the real salary is set
// later by the accountant in the Accounting portal (admin is excluded
// from finance), so the wizard never collects it here.
//
// Staff have a profile table (staff_members), so returning-employee
// linking via previous_archive_id is supported, same as Teacher.

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Info } from 'lucide-react';
import { adminApi } from '../../../../services/api';
import Input from '../../../common/Input';
import Button from '../../../common/Button';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../../../utils/passwordPolicy';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../../common/ReturningEmployeeSearch';
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../../EmployeeHRFields';
import type { CreatedEmployee } from './TeacherIdentityForm';

type FormFields = {
  fullName: string;
  position: string;
  emergencyContact: string;
  username: string;
  password: string;
} & EmployeeHRFormFields;

interface Props {
  onCreated: (e: CreatedEmployee) => void;
}

export default function StaffIdentityForm({ onCreated }: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [createLogin, setCreateLogin] = useState(false);
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');
  const form = useForm<FormFields>();
  const watchedName = form.watch('fullName');

  const onSubmit = async (data: FormFields) => {
    if (createLogin && data.password && !isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.createStaff({
        ...hrPayload(data),
        fullName: data.fullName,
        position: data.position || null,
        emergencyContact: data.emergencyContact || undefined,
        salaryAmount: 0,
        currency: 'USD',
        previousArchiveId: prevArchiveId || undefined,
        createLogin,
        username: createLogin ? (data.username || undefined) : undefined,
        password: createLogin ? (data.password || undefined) : undefined,
      });
      const created: CreatedEmployee = {
        id: res.data?.id,
        fullName: data.fullName,
        username: res.data?.username,
        tempPassword: res.data?.tempPassword,
      };
      toast.success(t('admin.wizard.identity_saved', 'Employee created. Add optional details below.'));
      onCreated(created);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.wizard.failed_create_staff', 'Failed to create staff member'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <Trans i18nKey="admin.staff_emp.finance_note" components={{ b: <span className="font-medium" /> }} />
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.staff_emp.full_name')} <span className="text-rose-600">*</span>
          </label>
          <Input placeholder={t('admin.staff_emp.full_name')} {...form.register('fullName', { required: true })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.position')}</label>
          <Input placeholder={t('admin.staff_emp.position_ph')} {...form.register('position')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.emergency_contact')}</label>
          <Input placeholder={t('admin.staff_emp.emergency_contact')} {...form.register('emergencyContact')} />
        </div>
      </div>

      {/* Optional login — lets this staff member sign in on mobile to clock in/out. */}
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createLogin}
            onChange={e => setCreateLogin(e.target.checked)}
            className="w-4 h-4 text-primary-600"
          />
          <span className="text-sm font-medium text-gray-700">{t('admin.staff_emp.create_login')}</span>
        </label>
        <p className="text-xs text-gray-400">{t('admin.staff_emp.create_login_hint')}</p>
        {createLogin && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.username_optional')}</label>
              <Input placeholder={t('admin.staff_emp.username_optional')} {...form.register('username')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.staff_emp.password')}</label>
              <Input type="password" placeholder={t('admin.staff_emp.password_default')} {...form.register('password')} />
            </div>
          </div>
        )}
      </div>

      <ReturningEmployeeSearch
        role="staff"
        nameQuery={watchedName}
        linkedId={prevArchiveId}
        linkedLabel={prevArchiveLabel}
        onPick={(c: ReturningEmployeeCandidate) => {
          form.setValue('fullName', c.fullName);
          setPrevArchiveId(c.id);
          setPrevArchiveLabel(`${c.fullName} · ${c.reason}${c.departureDate ? ` ${c.departureDate}` : ''}`);
        }}
        onClear={() => {
          setPrevArchiveId(null);
          setPrevArchiveLabel('');
        }}
      />

      <EmployeeHRFields register={form.register} />

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={submitting}>
          {t('admin.wizard.add_employee', 'Add Employee')}
        </Button>
      </div>
    </form>
  );
}
