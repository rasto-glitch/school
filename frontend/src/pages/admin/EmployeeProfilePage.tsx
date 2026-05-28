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

// /admin/employees/:role/:id — comprehensive view of one employee. The
// Documents tab is functional in Wave 1; the rest will fill in over Wave 2.

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

  useEffect(() => {
    if (!isValidRole(role) || !id) { setLoading(false); setError(t('admin.profile.invalid_url')); return; }
    setLoading(true);
    adminApi.getEmployeeProfile(role, id)
      .then(r => { setData(r.data); setError(null); })
      .catch((e: { response?: { status?: number; data?: { error?: string } } }) => {
        if (e.response?.status === 404) setError(t('admin.profile.not_found'));
        else setError(e.response?.data?.error || t('admin.profile.failed_load'));
      })
      .finally(() => setLoading(false));
  }, [role, id, t]);

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

  const onEdit = () => navigate(`/admin/employees?tab=${editTabForRole(role)}`);

  return (
    <PageLayout title={data?.profile.fullName || t('admin.profile.title')} subtitle={data ? t(`admin.profile.role_${data.profile.role}`) : ''}>
      <div className="mb-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/admin/employees')}>
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
          onEdit={onEdit}
          onExportJson={onExportJson}
          onExportPdf={onExportPdf}
        />
      ) : null}
    </PageLayout>
  );
}

// Maps the profile role to the EmployeesManagement tab key. teacher / driver
// have their own tabs; account-roles share the AccountEmployeesTab; staff
// has its own tab; staff/accountant are accounting-gated and just open the
// management page (the user lands on the closest available tab).
function editTabForRole(r: string | undefined): string {
  switch (r) {
    case 'teacher': return 'teacher';
    case 'driver': return 'teacher';        // Drivers managed under DriversManagement, but no tab in employees page
    case 'staff': return 'staff';
    case 'supervisor': return 'supervisor';
    case 'admin': return 'admin';
    case 'reception': return 'reception';
    case 'accountant': return 'accountant';
    default: return 'teacher';
  }
}
