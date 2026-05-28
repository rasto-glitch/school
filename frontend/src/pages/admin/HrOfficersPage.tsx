import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

// /admin/hr-officers — admin user-management surface for the HR-officer
// sub-role (Wave 2). Lists every admin and lets you toggle the flag.
// Promoting / demoting an admin notifies every OTHER admin of the school
// (backend-side, via the notifications table) so the change is
// transparent. Per the locked decisions, religion + SSN reads + redacted
// PII writes require the HR-officer flag.

interface AdminAccount {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  isActive: boolean;
  role: string;
  isHrOfficer?: boolean;
}

interface HrOfficer {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
}

export default function HrOfficersPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [officerIds, setOfficerIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [accountsRes, officersRes] = await Promise.all([
        adminApi.getAccounts(),
        adminApi.listHrOfficers(),
      ]);
      const all = (accountsRes.data ?? []) as AdminAccount[];
      const onlyAdmins = all.filter(a => a.role === 'admin');
      setAdmins(onlyAdmins);
      const officers = (officersRes.data?.officers ?? []) as HrOfficer[];
      setOfficerIds(new Set(officers.map(o => o.id)));
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.hr.failed_load'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (a: AdminAccount) => {
    setPending(a.id);
    try {
      const isOfficer = officerIds.has(a.id);
      if (isOfficer) await adminApi.demoteHrOfficer(a.id);
      else await adminApi.promoteHrOfficer(a.id);
      toast.success(isOfficer ? t('admin.hr.demoted') : t('admin.hr.promoted'));
      await load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.hr.failed_toggle'));
    } finally { setPending(null); }
  };

  const sortedAdmins = useMemo(() => {
    return [...admins].sort((a, b) => {
      // HR officers first, then inactive last, then alpha.
      const ao = officerIds.has(a.id) ? 0 : 1;
      const bo = officerIds.has(b.id) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (`${a.firstName ?? ''} ${a.lastName ?? ''}`).localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''}`);
    });
  }, [admins, officerIds]);

  return (
    <PageLayout title={t('admin.hr.title')} subtitle={t('admin.hr.subtitle')}>
      <div className="space-y-4">
        <Card className="bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">{t('admin.hr.banner_title')}</p>
              <p className="text-sm text-amber-800 mt-1">{t('admin.hr.banner_body')}</p>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : sortedAdmins.length === 0 ? (
          <EmptyState title={t('admin.hr.empty')} description={t('admin.hr.empty_hint')} />
        ) : (
          <div className="space-y-2">
            {sortedAdmins.map(a => {
              const isOfficer = officerIds.has(a.id);
              const name = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.username;
              return (
                <Card key={a.id} className={a.isActive ? '' : 'opacity-60'}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{name}</p>
                        <span className="text-xs text-gray-500">@{a.username}</span>
                        {isOfficer && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            <ShieldCheck className="w-3 h-3" /> {t('admin.hr.officer_badge')}
                          </span>
                        )}
                        {!a.isActive && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('admin.hr.inactive')}</span>}
                      </div>
                      {a.email && <p className="text-xs text-gray-500 mt-0.5">{a.email}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant={isOfficer ? 'danger' : 'primary'}
                      onClick={() => toggle(a)}
                      loading={pending === a.id}
                      disabled={!a.isActive}
                    >
                      {isOfficer ? t('admin.hr.demote') : t('admin.hr.promote')}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
