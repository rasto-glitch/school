import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import TuitionStudentsTab from './TuitionStudentsTab';
import TuitionFamiliesTab from './TuitionFamiliesTab';
import TuitionPlansTab from './TuitionPlansTab';
import TuitionSettingsTab from './TuitionSettingsTab';
import TuitionArchiveTab from './TuitionArchiveTab';
import StaffSalariesTab from './StaffSalariesTab';

type Section = 'students' | 'staff';
type StudentTab = 'students' | 'families' | 'plans' | 'archive' | 'settings';

export default function AdminTuitionPage() {
  const { user, school } = useAuthStore();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;

  const basePath = '/accounting';
  const [section, setSection] = useState<Section>('students');
  const [studentTab, setStudentTab] = useState<StudentTab>('students');

  const studentTabs: { id: StudentTab; label: string; show: boolean }[] = [
    { id: 'students', label: 'Students', show: true },
    { id: 'families', label: 'Families', show: true },
    { id: 'plans', label: 'Plans', show: canWrite },
    { id: 'archive', label: 'Archive', show: true },
    { id: 'settings', label: 'Settings', show: canWrite },
  ];

  if (!isPremium) {
    return (
      <PageLayout title="Accounting" subtitle="Premium feature">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">Accounting module not enabled</h3>
          <p className="text-sm text-amber-800">
            The accounting module is part of the Premium plan. Contact Scholify to enable it for your school.
          </p>
        </div>
      </PageLayout>
    );
  }

  const subtitle =
    section === 'staff'
      ? (canWrite ? 'Track salaries and payments' : 'View staff salaries (read-only)')
      : (canWrite ? 'Plans, payments, reminders' : 'View tuition status (read-only)');

  const sectionTabs: { id: Section; label: string; show: boolean }[] = [
    { id: 'students', label: 'Students', show: true },
    { id: 'staff', label: 'Teachers & staff', show: canWrite },
  ];

  return (
    <PageLayout title="Accounting" subtitle={subtitle}>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
        {sectionTabs.filter(t => t.show).map(t => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${section === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'students' && (
        <>
          <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1 w-fit mb-6">
            {studentTabs.filter(t => t.show).map(t => (
              <button
                key={t.id}
                onClick={() => setStudentTab(t.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${studentTab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {studentTab === 'students' && <TuitionStudentsTab basePath={basePath} canWrite={canWrite} />}
          {studentTab === 'families' && <TuitionFamiliesTab basePath={basePath} />}
          {studentTab === 'plans' && canWrite && <TuitionPlansTab />}
          {studentTab === 'archive' && <TuitionArchiveTab />}
          {studentTab === 'settings' && canWrite && <TuitionSettingsTab />}
        </>
      )}

      {section === 'staff' && canWrite && <StaffSalariesTab />}
    </PageLayout>
  );
}
