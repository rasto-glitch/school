import { useSearchParams } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { useAuthStore } from '../../store/authStore';
import TeacherEmployeesTab from './employees/TeacherEmployeesTab';
import AccountEmployeesTab from './employees/AccountEmployeesTab';
import StaffEmployeesTab from './employees/StaffEmployeesTab';

// Unified Employees page. Replaces the old standalone /admin/teachers page.
// Sub-tabs: Teacher · Supervisor · Administration · Staff. Each tab owns the
// add / manage / archive flow for its employee type. (Staff lands in a later
// phase; the accounting portal reads these employees for salaries.)
//
// The active tab is mirrored to the ?tab= query param so deep links and the
// /admin/teachers → /admin/employees redirect land on the right place.

type EmpTab = 'teacher' | 'supervisor' | 'admin' | 'staff';

export default function EmployeesManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Staff is backed by the accounting-premium staff_members table; hide the
  // sub-tab entirely when the accounting module is off.
  const staffEnabled = useAuthStore(s => s.school?.features?.tuition_fees === true);

  const TABS: { key: EmpTab; label: string }[] = [
    { key: 'teacher', label: 'Teachers' },
    { key: 'supervisor', label: 'Supervisors' },
    { key: 'admin', label: 'Administration' },
    ...(staffEnabled ? [{ key: 'staff' as const, label: 'Staff' }] : []),
  ];

  const raw = (searchParams.get('tab') || 'teacher') as EmpTab;
  const active: EmpTab = TABS.some(t => t.key === raw) ? raw : 'teacher';

  const setTab = (key: EmpTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageLayout title="Employees" subtitle="Add, manage and archive every employee">
      <div className="space-y-6">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${active === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {active === 'teacher' && <TeacherEmployeesTab />}
        {active === 'supervisor' && <AccountEmployeesTab role="supervisor" singular="Supervisor" />}
        {active === 'admin' && <AccountEmployeesTab role="admin" singular="Administrator" />}
        {active === 'staff' && staffEnabled && <StaffEmployeesTab />}
      </div>
    </PageLayout>
  );
}
