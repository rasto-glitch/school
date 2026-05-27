import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import TuitionStudentsTab from './TuitionStudentsTab';
import TuitionFamiliesTab from './TuitionFamiliesTab';
import TuitionPlansTab from './TuitionPlansTab';
import TuitionSettingsTab from './TuitionSettingsTab';
import TuitionArchiveTab from './TuitionArchiveTab';
import TuitionVoidedTab from './TuitionVoidedTab';
import StaffSalariesTab from './StaffSalariesTab';

type StudentTab = 'students' | 'families' | 'plans' | 'archive' | 'voided' | 'settings';

export default function AdminTuitionPage() {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const location = useLocation();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;
  const isStaffSection = location.pathname.startsWith('/accounting/staff');

  const basePath = '/accounting';
  const [studentTab, setStudentTab] = useState<StudentTab>('students');

  const studentTabs: { id: StudentTab; label: string; show: boolean }[] = [
    { id: 'students', label: t('accounting.tuition.tab_students'), show: true },
    { id: 'families', label: t('accounting.tuition.tab_families'), show: true },
    { id: 'plans', label: t('accounting.tuition.tab_plans'), show: canWrite },
    { id: 'archive', label: t('accounting.tuition.tab_archive'), show: true },
    { id: 'voided', label: t('accounting.tuition.tab_voided'), show: canWrite },
    { id: 'settings', label: t('accounting.tuition.tab_settings'), show: canWrite },
  ];

  if (!isPremium) {
    return (
      <PageLayout title={t('accounting.title')} subtitle={t('accounting.premium_subtitle')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">{t('accounting.tuition.not_enabled_title')}</h3>
          <p className="text-sm text-amber-800">
            {t('accounting.tuition.not_enabled_body')}
          </p>
        </div>
      </PageLayout>
    );
  }

  if (isStaffSection) {
    if (!canWrite) {
      return (
        <PageLayout title={t('accounting.tuition.staff_title')} subtitle={t('accounting.tuition.restricted')}>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
            <p className="text-sm text-amber-800">{t('accounting.tuition.no_staff_access')}</p>
          </div>
        </PageLayout>
      );
    }
    return (
      <PageLayout title={t('accounting.tuition.staff_title')} subtitle={canWrite ? t('accounting.tuition.staff_sub_rw') : t('accounting.tuition.staff_sub_ro')}>
        <StaffSalariesTab />
      </PageLayout>
    );
  }

  return (
    <PageLayout title={t('accounting.tuition.students_title')} subtitle={canWrite ? t('accounting.tuition.students_sub_rw') : t('accounting.tuition.students_sub_ro')}>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        {studentTabs.filter(tab => tab.show).map(tab => (
          <button
            key={tab.id}
            onClick={() => setStudentTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${studentTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {studentTab === 'students' && <TuitionStudentsTab basePath={basePath} canWrite={canWrite} />}
      {studentTab === 'families' && <TuitionFamiliesTab basePath={basePath} />}
      {studentTab === 'plans' && canWrite && <TuitionPlansTab />}
      {studentTab === 'archive' && <TuitionArchiveTab />}
      {studentTab === 'voided' && canWrite && <TuitionVoidedTab />}
      {studentTab === 'settings' && canWrite && <TuitionSettingsTab />}
    </PageLayout>
  );
}
