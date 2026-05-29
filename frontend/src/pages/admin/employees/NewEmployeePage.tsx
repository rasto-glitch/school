// Standalone route component for /admin/employees/new/:role. Wraps the
// embeddable NewEmployeeWizard in PageLayout so the role-titled chrome only
// shows on the deep-link route; when EmployeesManagement embeds the wizard
// inside its "Add new" top tab it provides its own chrome instead.

import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import PageLayout from '../../../components/layout/PageLayout';
import NewEmployeeWizard from '../../../components/admin/employees/wizard/NewEmployeeWizard';
import type { EmployeeRole } from '../../../types/employeeRecords';

const KNOWN_ROLES: EmployeeRole[] = [
  'teacher', 'supervisor', 'accountant', 'reception', 'staff', 'admin', 'driver',
];

function isKnownRole(r: string | undefined): r is EmployeeRole {
  return !!r && (KNOWN_ROLES as string[]).includes(r);
}

const TITLE_KEYS: Record<string, { key: string; fallback: string }> = {
  teacher: { key: 'admin.wizard.title_teacher', fallback: 'Add new teacher' },
  supervisor: { key: 'admin.wizard.title_supervisor', fallback: 'Add new supervisor' },
  accountant: { key: 'admin.wizard.title_accountant', fallback: 'Add new accountant' },
  reception: { key: 'admin.wizard.title_reception', fallback: 'Add new receptionist' },
  staff: { key: 'admin.wizard.title_staff', fallback: 'Add new staff member' },
  admin: { key: 'admin.wizard.title_admin', fallback: 'Add new administrator' },
};

export default function NewEmployeePage() {
  const { role } = useParams<{ role: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!isKnownRole(role)) return <Navigate to="/admin/employees" replace />;

  const def = TITLE_KEYS[role] ?? TITLE_KEYS.teacher;
  const title = t(def.key, def.fallback);
  const subtitle = t('admin.wizard.subtitle', 'Fill in identity, then add optional details below.');

  return (
    <PageLayout title={title} subtitle={subtitle}>
      <div className="max-w-5xl space-y-4">
        <button
          onClick={() => navigate(`/admin/employees?top=active&sub=${role}`)}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" /> {t('admin.wizard.back_to_employees', 'Back to Employees')}
        </button>
        <NewEmployeeWizard role={role} />
      </div>
    </PageLayout>
  );
}
