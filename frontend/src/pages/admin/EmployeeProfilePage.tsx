import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import PageLayout from '../../components/layout/PageLayout';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import EmployeeProfileView from '../../components/admin/employees/EmployeeProfileView';
import { adminApi } from '../../services/api';
import type { EmployeeProfileResponse, EmployeeRole } from '../../types/employeeDocs';

// /admin/employees/:role/:id — comprehensive view of one employee. Identity
// editing happens inline via the EditIdentityPanel inside EmployeeProfileView;
// onSaved triggers a profile re-fetch so the header / at-a-glance / extended
// strip refresh immediately.

const VALID_ROLES: EmployeeRole[] = [
  'teacher', 'driver', 'staff', 'supervisor', 'admin', 'reception', 'accountant',
];

function isValidRole(r: string | undefined): r is EmployeeRole {
  return !!r && (VALID_ROLES as string[]).includes(r);
}

export default function EmployeeProfilePage() {
  const { role, id } = useParams<{ role: string; id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmployeeProfileResponse | null>(null);

  const load = async () => {
    if (!isValidRole(role) || !id) { setLoading(false); setError(t('admin.profile.invalid_url')); return; }
    setLoading(true);
    try {
      const r = await adminApi.getEmployeeProfile(role, id);
      setData(r.data); setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 404) setError(t('admin.profile.not_found'));
      else setError(e.response?.data?.error || t('admin.profile.failed_load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [role, id]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onExportJson = async () => {
    if (!isValidRole(role) || !id || !data) return;
    const r = await adminApi.exportEmployeeProfileJson(role, id);
    const safe = data.profile.fullName.replace(/[^a-z0-9-_]+/gi, '_');
    downloadBlob(r.data as Blob, `employee-${role}-${safe}.json`);
  };

  const onExportPdf = async () => {
    if (!isValidRole(role) || !id || !data) return;
    const r = await adminApi.exportEmployeeProfilePdf(role, id);
    const safe = data.profile.fullName.replace(/[^a-z0-9-_]+/gi, '_');
    downloadBlob(r.data as Blob, `employee-${role}-${safe}.pdf`);
  };

  const goToList = () => {
    if (isValidRole(role)) navigate(`/admin/employees?top=active&sub=${role}`);
    else navigate('/admin/employees');
  };

  return (
    <PageLayout title={data?.profile.fullName || t('admin.profile.title')} subtitle={data ? t(`admin.profile.role_${data.profile.role}`) : ''}>
      <div className="mb-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={goToList}>
          {t('common.back')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : error ? (
        <EmptyState title={error} />
      ) : data ? (
        <EmployeeProfileView
          profile={data.profile}
          documents={data.documents}
          hrOfficer={data.hrOfficer}
          onSaved={load}
          onExportJson={onExportJson}
          onExportPdf={onExportPdf}
          onTerminated={goToList}
        />
      ) : null}
    </PageLayout>
  );
}
