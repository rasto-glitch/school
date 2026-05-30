// /admin/archived-employees/:id — full-page view of one archived employee.
// Replaces the per-row detail modal that used to open from the archived
// lists. Read-only end to end; Restore + Download PDF live on the page
// header (top-right of the header card).

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import PageLayout from '../../components/layout/PageLayout';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import ArchivedEmployeeProfileView from '../../components/admin/employees/ArchivedEmployeeProfileView';
import { adminApi } from '../../services/api';
import type { ArchivedEmployeeProfileResponse } from '../../types/employeeRecords';

export default function ArchivedEmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ArchivedEmployeeProfileResponse | null>(null);

  const load = async () => {
    if (!id) { setError(t('admin.profile.invalid_url')); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await adminApi.getArchivedEmployeeProfile(id);
      setData(r.data);
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 404) setError(t('admin.profile.not_found'));
      else setError(e.response?.data?.error || t('admin.profile.failed_load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const goBack = () => navigate('/admin/employees?top=archived&sub=teacher');

  return (
    <PageLayout title={data?.record.fullName || t('admin.arch_profile.title', 'Archived employee')} subtitle={data ? t(`admin.profile.role_${data.record.role}`, data.record.role) : ''}>
      <div className="mb-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={goBack}>
          {t('common.back')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : error ? (
        <EmptyState title={error} />
      ) : data ? (
        <ArchivedEmployeeProfileView data={data} onRestored={goBack} />
      ) : null}
    </PageLayout>
  );
}
