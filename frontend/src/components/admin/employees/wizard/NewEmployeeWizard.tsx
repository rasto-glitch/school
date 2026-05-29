// The main NewEmployeeWizard shell. Section 1 is the role-specific identity
// form (which, on success, returns the created row's id). Sections 2–5 are
// role-agnostic and lock until that id exists; each writes durably through
// its own Save button so partial completion is harmless.
//
// Done returns to the role tab in EmployeesManagement; Add another resets
// the wizard for the next employee (TeacherIdentityForm remounts on a key
// change so RHF state and class checkboxes clear cleanly).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus } from 'lucide-react';
import PageLayout from '../../../layout/PageLayout';
import Button from '../../../common/Button';
import WizardSection from './WizardSection';
import TeacherIdentityForm, { type CreatedEmployee } from './TeacherIdentityForm';
import EmergencyContactsSection from './EmergencyContactsSection';
import DocumentsSection from './DocumentsSection';
import ExtendedProfileForm from '../ExtendedProfileForm';
import ProfessionalPhotoField from '../../ProfessionalPhotoField';
import type { EmployeeRole } from '../../../../types/employeeRecords';

interface Props {
  role: EmployeeRole;
}

const ROLE_LABELS: Record<string, { titleKey: string; fallback: string }> = {
  teacher: { titleKey: 'admin.wizard.title_teacher', fallback: 'Add new teacher' },
  supervisor: { titleKey: 'admin.wizard.title_supervisor', fallback: 'Add new supervisor' },
  accountant: { titleKey: 'admin.wizard.title_accountant', fallback: 'Add new accountant' },
  reception: { titleKey: 'admin.wizard.title_reception', fallback: 'Add new receptionist' },
  staff: { titleKey: 'admin.wizard.title_staff', fallback: 'Add new staff member' },
  admin: { titleKey: 'admin.wizard.title_admin', fallback: 'Add new administrator' },
};

function LockedPlaceholder({ message }: { message: string }) {
  return (
    <p className="text-sm text-gray-400 italic py-4 text-center border border-dashed border-gray-200 rounded-lg">
      {message}
    </p>
  );
}

function IdentitySummary({ employee }: { employee: CreatedEmployee }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
      <p className="font-semibold text-emerald-900">{employee.fullName}</p>
      {employee.username && (
        <p className="text-xs text-emerald-800 mt-0.5">
          {t('admin.wizard.summary_username', 'Username')}: <span className="font-mono">{employee.username}</span>
          {employee.tempPassword && (
            <>
              {' · '}
              {t('admin.wizard.summary_temp_password', 'Temporary password')}: <span className="font-mono">{employee.tempPassword}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export default function NewEmployeeWizard({ role }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [createdEmployee, setCreatedEmployee] = useState<CreatedEmployee | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [extendedSaved, setExtendedSaved] = useState(false);
  const [contactsCount, setContactsCount] = useState(0);
  const [docsCount, setDocsCount] = useState(0);
  // Bumped on "Add another" so the identity form remounts and clears state.
  const [resetKey, setResetKey] = useState(0);

  const labelDef = ROLE_LABELS[role] ?? ROLE_LABELS.teacher;
  const pageTitle = t(labelDef.titleKey, labelDef.fallback);
  const subtitle = t('admin.wizard.subtitle', 'Fill in identity, then add optional details below.');

  const goToList = () => navigate(`/admin/employees?tab=${role}`);
  const onAddAnother = () => {
    setCreatedEmployee(null);
    setPhotoUploaded(false);
    setExtendedSaved(false);
    setContactsCount(0);
    setDocsCount(0);
    setResetKey(k => k + 1);
    // Scroll to top so the operator lands on Section 1 again.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const lockedMessage = t('admin.wizard.locked_hint', 'Available after you add the employee above.');

  const renderIdentity = () => {
    if (createdEmployee) return <IdentitySummary employee={createdEmployee} />;
    if (role === 'teacher') return <TeacherIdentityForm key={resetKey} onCreated={setCreatedEmployee} />;
    // Phase 2 ships Teacher only; the other identity forms land in Phase 3.
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        {t('admin.wizard.role_not_ready', 'This role is not yet supported by the wizard. It will land in a follow-up phase.')}
      </p>
    );
  };

  const ec = contactsCount;
  const dc = docsCount;

  return (
    <PageLayout title={pageTitle} subtitle={subtitle}>
      <div className="max-w-5xl space-y-4">
        <button
          onClick={goToList}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" /> {t('admin.wizard.back_to_employees', 'Back to Employees')}
        </button>

        <WizardSection
          number={1}
          title={t('admin.wizard.section_identity', 'Identity')}
          description={t('admin.wizard.section_identity_desc', 'Required to create the employee record.')}
          status={createdEmployee ? 'saved' : 'required'}
        >
          {renderIdentity()}
        </WizardSection>

        <WizardSection
          number={2}
          title={t('admin.wizard.section_photo', 'Profile photo')}
          status={photoUploaded ? 'saved' : 'optional'}
          disabled={!createdEmployee}
        >
          {createdEmployee ? (
            <ProfessionalPhotoField
              role={role as Parameters<typeof ProfessionalPhotoField>[0]['role']}
              employeeId={createdEmployee.id}
              currentUrl={null}
              onUploaded={() => setPhotoUploaded(true)}
            />
          ) : (
            <LockedPlaceholder message={lockedMessage} />
          )}
        </WizardSection>

        <WizardSection
          number={3}
          title={t('admin.wizard.section_extended', 'Extended profile')}
          description={t('admin.wizard.section_extended_desc', 'Sensitive fields are encrypted at rest.')}
          status={extendedSaved ? 'saved' : 'optional'}
          disabled={!createdEmployee}
        >
          {createdEmployee ? (
            <ExtendedProfileForm
              role={role}
              employeeId={createdEmployee.id}
              allowRedact={false}
              onSaved={() => setExtendedSaved(true)}
            />
          ) : (
            <LockedPlaceholder message={lockedMessage} />
          )}
        </WizardSection>

        <WizardSection
          number={4}
          title={t('admin.wizard.section_contacts', 'Emergency contacts')}
          status={ec > 0 ? 'saved' : 'optional'}
          statusLabel={ec > 0 ? t('admin.wizard.status_n_contacts', { defaultValue: '{{count}} saved', count: ec }) : undefined}
          disabled={!createdEmployee}
        >
          {createdEmployee ? (
            <EmergencyContactsSection
              role={role}
              employeeId={createdEmployee.id}
              onCountChange={setContactsCount}
            />
          ) : (
            <LockedPlaceholder message={lockedMessage} />
          )}
        </WizardSection>

        <WizardSection
          number={5}
          title={t('admin.wizard.section_documents', 'Documents')}
          status={dc > 0 ? 'saved' : 'optional'}
          statusLabel={dc > 0 ? t('admin.wizard.status_n_documents', { defaultValue: '{{count}} uploaded', count: dc }) : undefined}
          disabled={!createdEmployee}
        >
          {createdEmployee ? (
            <DocumentsSection
              role={role}
              employeeId={createdEmployee.id}
              onCountChange={setDocsCount}
            />
          ) : (
            <LockedPlaceholder message={lockedMessage} />
          )}
        </WizardSection>

        {createdEmployee && (
          <div className="flex justify-between items-center pt-2">
            <Button variant="ghost" icon={<Plus className="w-4 h-4" />} onClick={onAddAnother}>
              {t('admin.wizard.add_another', 'Add another')}
            </Button>
            <Button onClick={goToList}>
              {t('admin.wizard.done', 'Done')}
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
