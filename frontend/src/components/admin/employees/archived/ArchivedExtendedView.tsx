// Read-only extended-profile view for the archived profile page.
// Renders the same field set as the live ExtendedProfileForm but as
// labelled text rows instead of editable inputs. HR-officer-only fields
// surface as the existing [hr_officer_required] sentinel for non-HR
// readers (the bundle endpoint already did the redaction).

import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import Card from '../../../common/Card';
import type { ExtendedProfile } from '../../../../types/employeeRecords';
import { REDACTED } from '../../../../types/employeeRecords';

interface Props {
  profile: ExtendedProfile | null;
  hrOfficer: boolean;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const isRedacted = value === REDACTED;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <dt className="text-xs text-gray-500 w-36 shrink-0 pt-0.5">{label}</dt>
      <dd className={`text-sm break-words min-w-0 ${isRedacted ? 'text-rose-600 italic' : 'text-gray-800'}`}>
        {isRedacted ? <span className="inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> {value}</span>
          : (value || <span className="text-gray-400">—</span>)}
      </dd>
    </div>
  );
}

export default function ArchivedExtendedView({ profile, hrOfficer }: Props) {
  const { t } = useTranslation();

  if (!profile) {
    return <Card><p className="text-sm text-gray-400">{t('admin.arch_profile.no_extended', 'No extended profile data on file.')}</p></Card>;
  }

  if (profile.redacted) {
    return (
      <Card className="bg-rose-50 border-rose-200">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-900">{t('admin.ext.is_redacted_title')}</p>
            <p className="text-sm text-rose-700 mt-1">
              {profile.redactedAt ? t('admin.ext.is_redacted_body', { date: profile.redactedAt.slice(0, 10) }) : null}
            </p>
            {profile.redactedReason && (
              <p className="text-xs text-rose-600 mt-2">{t('admin.ext.reason')}: {profile.redactedReason}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  const langs = (profile.languagesSpoken ?? []).join(', ');

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.ext.section_personal')}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Row label={t('admin.ext.mother_name')} value={profile.motherFullName} />
          <Row label={t('admin.ext.father_name')} value={profile.fatherFullName} />
          <Row label={t('admin.ext.spouse_name')} value={profile.spouseName} />
          <Row label={t('admin.ext.dependents')} value={profile.dependentsCount != null ? String(profile.dependentsCount) : null} />
          <Row label={t('admin.ext.place_of_birth')} value={profile.placeOfBirth} />
          <Row label={t('admin.ext.nationality')} value={profile.nationality} />
          <Row label={t('admin.ext.blood_type')} value={profile.bloodType} />
          <Row label={t('admin.ext.languages')} value={langs || null} />
        </dl>
      </Card>

      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.ext.section_financial')}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Row label={t('admin.ext.bank_name')} value={profile.bankName} />
          <Row label={t('admin.ext.bank_iban')} value={profile.bankIban} />
          <Row label={t('admin.ext.tax_id')} value={profile.taxId} />
        </dl>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('admin.ext.section_hr_only')}</p>
          {!hrOfficer && (
            <span className="text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-full inline-flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> {t('admin.ext.hr_only_pill')}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Row label={t('admin.ext.religion')} value={profile.religion} />
          <Row label={t('admin.ext.ssn')} value={profile.socialInsuranceNo} />
        </dl>
      </Card>
    </div>
  );
}
