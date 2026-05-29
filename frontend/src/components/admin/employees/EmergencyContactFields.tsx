// Extracted from Wave2Tabs.EmergencyContactsTab modal so the same fields
// can be rendered inline by the Add-employee wizard. Pure presentational —
// state and save logic stay in the caller (the modal in Wave2Tabs / the
// section block in NewEmployeeWizard).

import { useTranslation } from 'react-i18next';
import Input from '../../common/Input';

export interface ContactFormState {
  fullName: string;
  relationship: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  /** Stored as a string for input binding; coerced to number on submit. */
  priority: string;
}

// Colocated with the component on purpose — both consumers (Wave2Tabs modal
// + the wizard's EC section) need this exact shape. Vite's react-refresh
// rule wants component-only exports; we accept the HMR cost here because
// splitting a 6-line constant into a new file isn't worth the indirection.
// eslint-disable-next-line react-refresh/only-export-components
export const EMPTY_CONTACT: ContactFormState = {
  fullName: '', relationship: '', phone: '', altPhone: '',
  email: '', address: '', priority: '1',
};

interface Props {
  value: ContactFormState;
  onChange: (v: ContactFormState) => void;
}

export default function EmergencyContactFields({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.full_name')}</label>
        <Input value={value.fullName} onChange={e => onChange({ ...value, fullName: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.relationship')}</label>
        <Input value={value.relationship} onChange={e => onChange({ ...value, relationship: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.priority')}</label>
        <Input type="number" min={1} max={10} value={value.priority} onChange={e => onChange({ ...value, priority: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.phone')}</label>
        <Input value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.alt_phone')}</label>
        <Input value={value.altPhone} onChange={e => onChange({ ...value, altPhone: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.email')}</label>
        <Input value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.ec.address')}</label>
        <Input value={value.address} onChange={e => onChange({ ...value, address: e.target.value })} />
      </div>
    </div>
  );
}
