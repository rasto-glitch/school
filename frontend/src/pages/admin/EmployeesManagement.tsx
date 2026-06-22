// Restructured Employees page. Three top tabs — Add new / Active / Archived
// — each split into the same six role sub-tabs (teacher, supervisor,
// administration, reception, accountant, staff). Accountant and Staff
// only show when the tuition-fees feature is on (matches the legacy gating).
//
// Add embeds NewEmployeeWizard directly; Active and Archived render the
// shared SortableTable via per-role list wrappers. Click an active row to
// open the employee profile; click an archived row to open the shared
// detail modal.
//
// URL params:
//   ?top=add|active|archived  (default: active)
//   ?sub=<role>              (default: teacher)
// Legacy ?tab=<role> still works and maps to ?top=active&sub=<role>.

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageLayout from '../../components/layout/PageLayout';
import { useAuthStore } from '../../store/authStore';
import NewEmployeeWizard from '../../components/admin/employees/wizard/NewEmployeeWizard';
import EmployeeBulkUpload from '../../components/admin/employees/EmployeeBulkUpload';
import ActiveEmployeeList from './employees/ActiveEmployeeList';
import ArchivedEmployeeList from './employees/ArchivedEmployeeList';
import type { EmployeeRole } from '../../types/employeeRecords';

type TopTab = 'add' | 'active' | 'archived';
type SubTab = 'teacher' | 'supervisor' | 'admin' | 'reception' | 'accountant' | 'staff';

const TOP_TABS: { key: TopTab; labelKey: string; fallback: string }[] = [
  { key: 'add', labelKey: 'admin.employees.tab_add', fallback: 'Add new employee' },
  { key: 'active', labelKey: 'admin.employees.tab_active', fallback: 'Active employees' },
  { key: 'archived', labelKey: 'admin.employees.tab_archived', fallback: 'Archived' },
];

export default function EmployeesManagement() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const accountingEnabled = useAuthStore(s => s.school?.features?.tuition_fees === true);

  // Legacy compat: ?tab=X gets normalised to ?top=active&sub=X on first load.
  useEffect(() => {
    const legacy = searchParams.get('tab');
    if (legacy && !searchParams.get('sub')) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      next.set('top', 'active');
      next.set('sub', legacy);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'teacher', label: t('admin.tab_teachers') },
    { key: 'supervisor', label: t('admin.tab_supervisors') },
    { key: 'admin', label: t('admin.tab_administration') },
    { key: 'reception', label: t('admin.tab_reception', 'Reception') },
    ...(accountingEnabled ? [{ key: 'accountant' as const, label: t('admin.tab_accountant', 'Accountant') }] : []),
    ...(accountingEnabled ? [{ key: 'staff' as const, label: t('admin.tab_staff') }] : []),
  ];

  const rawTop = (searchParams.get('top') || 'active') as TopTab;
  const top: TopTab = TOP_TABS.some(t => t.key === rawTop) ? rawTop : 'active';

  const rawSub = (searchParams.get('sub') || 'teacher') as SubTab;
  const sub: SubTab = SUB_TABS.some(t => t.key === rawSub) ? rawSub : 'teacher';

  const setTop = (key: TopTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('top', key);
    setSearchParams(next, { replace: true });
  };
  const setSub = (key: SubTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('sub', key);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageLayout title={t('nav.employees')} subtitle={t('admin.employees_subtitle')}>
      <div className="space-y-5">
        {/* Top tabs — primary nav between Add / Active / Archived. */}
        <div className="border-b border-gray-200 flex gap-6 -mx-1 px-1">
          {TOP_TABS.map(tt => (
            <button
              key={tt.key}
              onClick={() => setTop(tt.key)}
              className={`pb-2 -mb-px text-sm font-medium border-b-2 transition-colors ${top === tt.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t(tt.labelKey, tt.fallback)}
            </button>
          ))}
        </div>

        {/* Sub tabs — role within the selected top tab. */}
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {SUB_TABS.map(st => (
            <button
              key={st.key}
              onClick={() => setSub(st.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${sub === st.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Body — switch on (top, sub). */}
        {top === 'add' && sub === 'teacher' && <EmployeeBulkUpload role="teacher" />}
        {top === 'add' && <NewEmployeeWizard role={sub as EmployeeRole} />}
        {top === 'active' && <ActiveEmployeeList role={sub as EmployeeRole} />}
        {top === 'archived' && <ArchivedEmployeeList role={sub as EmployeeRole} />}
      </div>
    </PageLayout>
  );
}
