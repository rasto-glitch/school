import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Globe, UserX } from 'lucide-react';
import { format } from 'date-fns';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

// IT security page (audit.read). Surfaces the failed-login forensic log written
// best-effort by auth.controller.login() — recent attempts + 24h aggregates +
// the most-targeted accounts. Read-only; the data is auto-purged after 90 days.

interface Attempt {
  id: string;
  username: string;
  matchedUserId: string | null;
  matchedRole: string | null;
  ip: string | null;
  userAgent: string | null;
  attemptedAt: string;
}
interface Summary { last24h: number; adminTargeted24h: number; distinctIps24h: number }

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-red-50 text-red-700',
  teacher: 'bg-sky-50 text-sky-700',
  parent: 'bg-indigo-50 text-indigo-700',
  supervisor: 'bg-amber-50 text-amber-700',
  accountant: 'bg-emerald-50 text-emerald-700',
  reception: 'bg-violet-50 text-violet-700',
  driver: 'bg-slate-100 text-slate-700',
};

export default function SecurityPage() {
  const { t } = useTranslation();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getSecurityLoginAttempts()
      .then(r => { setAttempts(r.data?.attempts ?? []); setSummary(r.data?.summary ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Most-targeted accounts in the last 24h, grouped by account (matched id, or
  // the typed username when the account didn't exist).
  const targeted = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const map = new Map<string, { username: string; role: string | null; matched: boolean; count: number; ips: Set<string> }>();
    for (const a of attempts) {
      if (new Date(a.attemptedAt).getTime() < since) continue;
      const key = a.matchedUserId || `?${a.username}`;
      const e = map.get(key) ?? { username: a.username, role: a.matchedRole, matched: !!a.matchedUserId, count: 0, ips: new Set<string>() };
      e.count++;
      if (a.ip) e.ips.add(a.ip);
      map.set(key, e);
    }
    return Array.from(map.values()).sort((x, y) => y.count - x.count).slice(0, 6);
  }, [attempts]);

  const roleBadge = (role: string | null) => ROLE_BADGE[role ?? ''] ?? 'bg-gray-100 text-gray-600';
  const roleLabel = (role: string | null, matched: boolean) =>
    matched && role ? t(`roles.${role}_one`, { defaultValue: role }) : t('admin.security.no_account', 'no such account');
  const shortUa = (ua: string | null) => (!ua ? '—' : ua.length > 48 ? ua.slice(0, 48) + '…' : ua);

  if (loading) {
    return <PageLayout title={t('admin.security.title', 'Security')}><LoadingSpinner /></PageLayout>;
  }

  const stats = [
    { key: 'fails', label: t('admin.security.last24h', 'Failed attempts (24h)'), value: summary?.last24h ?? 0, icon: ShieldAlert, tint: 'bg-red-50 text-red-600' },
    { key: 'admin', label: t('admin.security.admin24h', 'Admin-targeted (24h)'), value: summary?.adminTargeted24h ?? 0, icon: UserX, tint: 'bg-amber-50 text-amber-600' },
    { key: 'ips', label: t('admin.security.ips24h', 'Distinct IPs (24h)'), value: summary?.distinctIps24h ?? 0, icon: Globe, tint: 'bg-blue-50 text-blue-600' },
  ];

  return (
    <PageLayout title={t('admin.security.title', 'Security')} subtitle={t('admin.security.subtitle', 'Failed sign-in attempts')}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(s => (
            <Card key={s.key}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${s.tint}`}><s.icon className="w-5 h-5" /></div>
              </div>
            </Card>
          ))}
        </div>

        {attempts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldAlert className="w-8 h-8 text-gray-400" />}
              title={t('admin.security.empty_title', 'No failed sign-ins')}
              description={t('admin.security.empty_sub', 'Nothing to review in the last 90 days.')}
            />
          </Card>
        ) : (
          <>
            {targeted.length > 0 && (
              <Card>
                <h3 className="font-semibold text-gray-900 mb-3">{t('admin.security.most_targeted', 'Most targeted accounts (24h)')}</h3>
                <ul className="divide-y divide-gray-100">
                  {targeted.map((tg, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadge(tg.role)}`}>{roleLabel(tg.role, tg.matched)}</span>
                      <span className="text-sm font-medium text-gray-900 truncate flex-1">{tg.username}</span>
                      <span className="text-xs text-gray-400">{t('admin.security.from_ips', { count: tg.ips.size, defaultValue: '{{count}} IPs' })}</span>
                      <span className="text-sm font-bold text-gray-900">{tg.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">{t('admin.security.recent', 'Recent attempts')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 pe-3 font-medium text-start">{t('admin.security.col_time', 'Time')}</th>
                      <th className="py-2 pe-3 font-medium text-start">{t('admin.security.col_account', 'Account')}</th>
                      <th className="py-2 pe-3 font-medium text-start">{t('admin.security.col_role', 'Role')}</th>
                      <th className="py-2 pe-3 font-medium text-start">{t('admin.security.col_ip', 'IP address')}</th>
                      <th className="py-2 font-medium text-start">{t('admin.security.col_device', 'Device')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {attempts.map(a => {
                      const isAdmin = a.matchedRole === 'admin' && !!a.matchedUserId;
                      return (
                        <tr key={a.id} className={isAdmin ? 'bg-red-50/40' : ''}>
                          <td className="py-2 pe-3 whitespace-nowrap text-gray-600">{format(new Date(a.attemptedAt), 'MMM d, HH:mm')}</td>
                          <td className="py-2 pe-3 font-medium text-gray-900">{a.username}</td>
                          <td className="py-2 pe-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadge(a.matchedRole)}`}>
                              {roleLabel(a.matchedRole, !!a.matchedUserId)}
                            </span>
                          </td>
                          <td className="py-2 pe-3 text-gray-600 whitespace-nowrap">{a.ip || '—'}</td>
                          <td className="py-2 text-gray-400" title={a.userAgent ?? ''}>{shortUa(a.userAgent)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
