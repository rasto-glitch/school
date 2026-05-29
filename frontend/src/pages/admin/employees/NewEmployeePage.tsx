// Route component for /admin/employees/new/:role. Reads the role param
// and delegates to NewEmployeeWizard. Unknown roles redirect back to
// the Employees list.

import { Navigate, useParams } from 'react-router-dom';
import NewEmployeeWizard from '../../../components/admin/employees/wizard/NewEmployeeWizard';
import type { EmployeeRole } from '../../../types/employeeRecords';

const KNOWN_ROLES: EmployeeRole[] = [
  'teacher', 'supervisor', 'accountant', 'reception', 'staff', 'admin', 'driver',
];

function isKnownRole(r: string | undefined): r is EmployeeRole {
  return !!r && (KNOWN_ROLES as string[]).includes(r);
}

export default function NewEmployeePage() {
  const { role } = useParams<{ role: string }>();
  if (!isKnownRole(role)) return <Navigate to="/admin/employees" replace />;
  return <NewEmployeeWizard role={role} />;
}
