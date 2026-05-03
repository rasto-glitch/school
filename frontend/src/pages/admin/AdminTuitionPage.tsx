import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import TuitionStudentsTab from './TuitionStudentsTab';
import TuitionFamiliesTab from './TuitionFamiliesTab';
import TuitionPlansTab from './TuitionPlansTab';
import TuitionSettingsTab from './TuitionSettingsTab';
import TuitionArchiveTab from './TuitionArchiveTab';

type Tab = 'students' | 'families' | 'plans' | 'archive' | 'settings';

export default function AdminTuitionPage() {
  const { user, school } = useAuthStore();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;

  const basePath = '/accounting';
  const [tab, setTab] = useState<Tab>('students');

  const tabs: { id: Tab; label: string; show: boolean }[] = [
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

  return (
    <PageLayout title="Accounting" subtitle={canWrite ? 'Plans, payments, reminders' : 'View tuition status (read-only)'}>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'students' && <TuitionStudentsTab basePath={basePath} canWrite={canWrite} />}
      {tab === 'families' && <TuitionFamiliesTab basePath={basePath} />}
      {tab === 'plans' && canWrite && <TuitionPlansTab />}
      {tab === 'archive' && <TuitionArchiveTab />}
      {tab === 'settings' && canWrite && <TuitionSettingsTab />}
    </PageLayout>
  );
}
