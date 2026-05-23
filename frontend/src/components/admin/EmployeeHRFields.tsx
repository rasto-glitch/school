import type { UseFormRegister } from 'react-hook-form';
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

const GENDER = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
const MARITAL = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];
const EMPLOYMENT = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
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
  return (
    <div className="space-y-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Employee details</p>
      <Input placeholder="Address" {...register('address')} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date of birth</label>
          <Input type="date" {...register('dateOfBirth')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date of hire</label>
          <Input type="date" {...register('hireDate')} />
        </div>
      </div>
      <Input placeholder="National / Civil ID" {...register('nationalId')} />
      <div className="grid grid-cols-2 gap-3">
        <Select options={GENDER} placeholder="Gender" {...register('gender')} />
        <Select options={MARITAL} placeholder="Marital status" {...register('maritalStatus')} />
      </div>
      <Select options={EMPLOYMENT} placeholder="Employment type" {...register('employmentType')} />
      <textarea
        placeholder="Qualifications / education"
        rows={2}
        {...register('qualifications')}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <textarea
        placeholder="Notes"
        rows={2}
        {...register('notes')}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}
