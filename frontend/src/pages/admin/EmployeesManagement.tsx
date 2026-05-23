import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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

type EmpTab = 'teacher' | 'supervisor' | 'admin' | 'reception' | 'accountant' | 'staff';

export default function EmployeesManagement() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Staff and Accountant are backed by the accounting-premium feature; hide
  // those sub-tabs entirely when the accounting module is off. (Accountant is
  // a role only when accounting is enabled; Staff reads staff_members.)
  const accountingEnabled = useAuthStore(s => s.school?.features?.tuition_fees === true);

  const TABS: { key: EmpTab; label: string }[] = [
    { key: 'teacher', label: t('admin.tab_teachers') },
    { key: 'supervisor', label: t('admin.tab_supervisors') },
    { key: 'admin', label: t('admin.tab_administration') },
    { key: 'reception', label: t('admin.tab_reception', 'Reception') },
    ...(accountingEnabled ? [{ key: 'accountant' as const, label: t('admin.tab_accountant', 'Accountant') }] : []),
    ...(accountingEnabled ? [{ key: 'staff' as const, label: t('admin.tab_staff') }] : []),
  ];

  const raw = (searchParams.get('tab') || 'teacher') as EmpTab;
  const active: EmpTab = TABS.some(t => t.key === raw) ? raw : 'teacher';

  const setTab = (key: EmpTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageLayout title={t('nav.employees')} subtitle={t('admin.employees_subtitle')}>
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
        {active === 'supervisor' && <AccountEmployeesTab role="supervisor" singular={t('admin.singular_supervisor')} />}
        {active === 'admin' && <AccountEmployeesTab role="admin" singular={t('admin.singular_administrator')} />}
        {active === 'reception' && <AccountEmployeesTab role="reception" singular={t('admin.singular_reception', 'Receptionist')} />}
        {active === 'accountant' && accountingEnabled && <AccountEmployeesTab role="accountant" singular={t('admin.singular_accountant', 'Accountant')} />}
        {active === 'staff' && accountingEnabled && <StaffEmployeesTab />}
      </div>
    </PageLayout>
  );
}
