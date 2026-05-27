import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Input from '../common/Input';
import Select from '../common/Select';

// Field names rendered here — intersect into a host form's useForm<> generic
// so `register('address')` etc. typecheck.
export interface EmployeeHRFormFields {
  address?: string;
  hireDate?: string;
  nationalId?: string;
  dateOfBirth?: string;
  maritalStatus?: string;
  gender?: string;
  employmentType?: string;
  qualifications?: string;
  notes?: string;
}

// Shared HR/identity fields for every employee form (account / teacher /
// driver / staff). Migration 024. Kept English to match the admin employee
// forms (which are not i18n'd). `register` is the host form's RHF register;
// the field names below must line up with the backend hrFields validator.
//
// emergencyContact is intentionally NOT here — teacher/driver forms already
// render it, and the account/staff forms add it next to their own fields.

// labels hold i18n keys; resolved with t() at render.
const GENDER = [
  { value: 'male', label: 'admin.hr_fields.gender_male' },
  { value: 'female', label: 'admin.hr_fields.gender_female' },
];
const MARITAL = [
  { value: 'single', label: 'admin.hr_fields.marital_single' },
  { value: 'married', label: 'admin.hr_fields.marital_married' },
  { value: 'divorced', label: 'admin.hr_fields.marital_divorced' },
  { value: 'widowed', label: 'admin.hr_fields.marital_widowed' },
];
const EMPLOYMENT = [
  { value: 'full_time', label: 'admin.hr_fields.emp_full_time' },
  { value: 'part_time', label: 'admin.hr_fields.emp_part_time' },
  { value: 'contract', label: 'admin.hr_fields.emp_contract' },
];

// Pick just the HR fields out of a form's data, for inclusion in a
// create/update payload. Values pass through verbatim ('' clears a field on
// edit; the backend normalizes '' → null).
const HR_KEYS: (keyof EmployeeHRFormFields)[] = [
  'address', 'hireDate', 'nationalId', 'dateOfBirth',
  'maritalStatus', 'gender', 'employmentType', 'qualifications', 'notes',
];
export function hrPayload(data: Record<string, any>): Partial<EmployeeHRFormFields> {
  const out: Record<string, any> = {};
  for (const k of HR_KEYS) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

export default function EmployeeHRFields({ register }: { register: UseFormRegister<any> }) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.hr_fields.section')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.address')}</label>
          <Input placeholder={t('admin.hr_fields.address')} {...register('address')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.national_id')}</label>
          <Input placeholder={t('admin.hr_fields.national_id')} {...register('nationalId')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.date_of_birth')}</label>
          <Input type="date" {...register('dateOfBirth')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.date_of_hire')}</label>
          <Input type="date" {...register('hireDate')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.gender')}</label>
          <Select options={GENDER.map(o => ({ value: o.value, label: t(o.label) }))} placeholder={t('admin.hr_fields.gender')} {...register('gender')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.marital_status')}</label>
          <Select options={MARITAL.map(o => ({ value: o.value, label: t(o.label) }))} placeholder={t('admin.hr_fields.marital_status')} {...register('maritalStatus')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.employment_type')}</label>
          <Select options={EMPLOYMENT.map(o => ({ value: o.value, label: t(o.label) }))} placeholder={t('admin.hr_fields.employment_type')} {...register('employmentType')} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.qualifications')}</label>
          <textarea
            placeholder={t('admin.hr_fields.qualifications')}
            rows={2}
            {...register('qualifications')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.hr_fields.notes')}</label>
          <textarea
            placeholder={t('admin.hr_fields.notes')}
            rows={2}
            {...register('notes')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>
    </div>
  );
}
