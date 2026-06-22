// Section 1 (Identity) of the NewEmployeeWizard, teacher variant. Ports
// the create-teacher fields from the legacy TeacherEmployeesTab Add card:
// name, phone, emergency contact, username/password (optional autogen),
// class checkboxes, returning-employee search, HR core fields.
//
// On successful POST to /admin/teachers it hands the created row to the
// wizard via onCreated() so the remaining sections can unlock. The
// post-create "photo phase" of the legacy form is now handled by the
// wizard's Section 2 instead.

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { adminApi } from '../../../../services/api';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../../../utils/passwordPolicy';
import Input from '../../../common/Input';
import Button from '../../../common/Button';
import ReturningEmployeeSearch, { type ReturningEmployeeCandidate } from '../../../common/ReturningEmployeeSearch';
import EmployeeHRFields, { hrPayload, type EmployeeHRFormFields } from '../../EmployeeHRFields';
import type { Class } from '../../../../types';

type FormFields = {
  fullName: string;
  phoneNumber: string;
  emergencyContact: string;
  email: string;
  username: string;
  password: string;
} & EmployeeHRFormFields;

export interface CreatedEmployee {
  id: string;
  fullName: string;
  username?: string;
  tempPassword?: string;
}

interface Props {
  onCreated: (e: CreatedEmployee) => void;
}

export default function TeacherIdentityForm({ onCreated }: Props) {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<Class[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [prevArchiveId, setPrevArchiveId] = useState<string | null>(null);
  const [prevArchiveLabel, setPrevArchiveLabel] = useState('');

  const form = useForm<FormFields>();
  const watchedName = form.watch('fullName');

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, []);

  const toggleClass = (id: string) =>
    setClassIds(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]));

  const onSubmit = async (data: FormFields) => {
    if (data.password && !isStrongPassword(data.password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.createTeacher({
        ...hrPayload(data),
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        emergencyContact: data.emergencyContact,
        email: data.email || undefined,
        classIds,
        username: data.username || undefined,
        password: data.password || undefined,
        previousArchiveId: prevArchiveId || undefined,
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
      toast.error(e.response?.data?.error || t('admin.wizard.failed_create_teacher', 'Failed to create teacher'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.teacher_emp.full_name')} <span className="text-rose-600">*</span>
          </label>
          <Input placeholder={t('admin.teacher_emp.full_name')} {...form.register('fullName', { required: true })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.primary_phone')}</label>
          <Input placeholder={t('admin.teacher_emp.primary_phone')} {...form.register('phoneNumber')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.emergency_contact')}</label>
          <Input placeholder={t('admin.teacher_emp.emergency_contact')} {...form.register('emergencyContact')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.email', 'Email')}</label>
          <Input type="email" placeholder={t('admin.teacher_emp.email', 'Email')} {...form.register('email')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.username_optional')}</label>
          <Input placeholder={t('admin.teacher_emp.username_optional')} {...form.register('username')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.teacher_emp.password')}</label>
          <Input type="password" placeholder={t('admin.teacher_emp.password_default')} {...form.register('password')} />
        </div>
      </div>

      <ReturningEmployeeSearch
        role="teacher"
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

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">{t('admin.teacher_emp.assign_classes')}</p>
        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
          {classes.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-1">{t('admin.wizard.no_classes', 'No classes available.')}</p>
          )}
          {classes.map(c => (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 rounded-lg">
              <input
                type="checkbox"
                checked={classIds.includes(c.id)}
                onChange={() => toggleClass(c.id)}
                className="w-4 h-4 text-primary-600"
              />
              <span className="text-sm text-gray-800">{c.name}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">{t('admin.teacher_emp.subjects_hint')}</p>
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
