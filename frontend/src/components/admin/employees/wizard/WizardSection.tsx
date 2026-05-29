// Reusable section card for the NewEmployeeWizard. Renders a numbered
// header, a status pill (Required / Optional / Saved / Locked), and a
// description; the children render the section's actual contents.
//
// `disabled` greys the card and disables interaction — used for sections
// 2–5 before the employee has been created.

import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Card from '../../../common/Card';

export type WizardSectionStatus = 'required' | 'optional' | 'saved' | 'locked';

interface Props {
  number: number;
  title: string;
  status: WizardSectionStatus;
  /** Optional override for the pill label (defaults to a translated status word). */
  statusLabel?: string;
  description?: string;
  disabled?: boolean;
  children: ReactNode;
}

export default function WizardSection({
  number, title, status, statusLabel, description, disabled = false, children,
}: Props) {
  const { t } = useTranslation();

  const renderPill = () => {
    switch (status) {
      case 'required':
        return (
          <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
            {statusLabel ?? t('admin.wizard.status_required', 'Required')}
          </span>
        );
      case 'optional':
        return (
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
            {statusLabel ?? t('admin.wizard.status_optional', 'Optional')}
          </span>
        );
      case 'saved':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
            <Check className="w-3 h-3" />
            {statusLabel ?? t('admin.wizard.status_saved', 'Saved')}
          </span>
        );
      case 'locked':
        return (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
            {statusLabel ?? t('admin.wizard.status_locked', 'Locked')}
          </span>
        );
    }
  };

  return (
    <Card className={disabled ? 'opacity-60' : ''}>
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 font-semibold text-sm flex items-center justify-center flex-shrink-0">
            {number}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
        </div>
        <div className="flex-shrink-0">{renderPill()}</div>
      </div>
      <div className={disabled ? 'pointer-events-none select-none' : ''}>{children}</div>
    </Card>
  );
}
