import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, GraduationCap, Users, Bus, ArrowRight, ArrowLeftRight,
  Star, CalendarClock, KeyRound, FileWarning, Wallet, History, AlertCircle,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';

// Admin dashboard "oversight cockpit" (Phase C2). Every region is gated on the
// viewer's capability — an Owner sees everything; a scoped admin sees only the
// widgets for areas they manage, and empty regions collapse. The server still
// enforces every endpoint; we simply don't fetch what the admin can't read.

interface FinanceOverview {
  monthByCurrency: { currency: string; income: number; expense: number; net: number }[];
  arByCurrency: { currency: string; balance: number }[];
  arStudentCount: number;
}
interface AuditLog {
  id: string;
  entityType?: string;
  action?: string;
  actorUsername?: string;
  label?: string | null;
  createdAt?: string;
}

const fmt = (n: number, ccy: string) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Owner sees all; missing clearance (legacy session) also falls back to all
  // since the server re-enforces every route anyway.
  const clearance = user?.clearance;
  const has = (cap: string) => !clearance || clearance.isOwner || clearance.capabilities.includes(cap);

  const [kpis, setKpis] = useState({ students: 0, staff: 0, drivers: 0 });
  const [attn, setAttn] = useState({ grades: 0, appointments: 0, resets: 0, expiring: 0, transfers: 0 });
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);

  useEffect(() => {
    // Fetch only what the viewer is allowed to read; swallow per-widget errors
    // so one failure never blanks the whole cockpit.
    const run = async () => {
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

      if (has('enrollment.read')) {
        const s = await safe(adminApi.getStudents());
        setKpis(k => ({ ...k, students: s?.data?.total || s?.data?.students?.length || 0 }));
      }
      if (has('staff.manage')) {
        const [tch, drv] = await Promise.all([safe(adminApi.getTeachers('list')), safe(adminApi.getDrivers())]);
        setKpis(k => ({ ...k, staff: tch?.data?.length || 0, drivers: drv?.data?.length || 0 }));
      }
      if (has('academics.oversee')) {
        const g = await safe(adminApi.getGradeReviewOverview());
        const pending = (g?.data?.classes ?? []).reduce((acc: number, c: { pendingCount?: number }) => acc + (c.pendingCount || 0), 0);
        setAttn(a => ({ ...a, grades: pending }));
      }
      if (has('students.manage')) {
        const ap = await safe(adminApi.getPendingAppointmentCount());
        setAttn(a => ({ ...a, appointments: ap?.data?.count || 0 }));
      }
      if (has('accounts.manage')) {
        const r = await safe(adminApi.getResetRequests());
        setAttn(a => ({ ...a, resets: Array.isArray(r?.data) ? r!.data.length : 0 }));
      }
      if (has('hr.read')) {
        const e = await safe(adminApi.listExpiringEmployeeDocuments(30));
        setAttn(a => ({ ...a, expiring: e?.data?.total || 0 }));
      }
      if (has('transfers.manage')) {
        const tr = await safe(adminApi.listIncomingTransfers());
        setAttn(a => ({ ...a, transfers: Array.isArray(tr?.data) ? tr!.data.length : 0 }));
      }
      if (has('finance.read')) {
        const f = await safe(adminApi.getFinanceOverview());
        if (f?.data) setFinance(f.data as FinanceOverview);
      }
      if (has('audit.read')) {
        const a = await safe(adminApi.getAuditLogs({ limit: 6 }));
        setAudit((a?.data?.logs ?? []) as AuditLog[]);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── KPI strip ──
  const kpiCards = [
    has('enrollment.read') && { to: '/admin/students', icon: GraduationCap, label: t('admin.students'), count: kpis.students, light: 'bg-blue-50 text-blue-600' },
    has('staff.manage') && { to: '/admin/employees', icon: Users, label: t('admin.teachers'), count: kpis.staff, light: 'bg-green-50 text-green-600' },
    has('staff.manage') && { to: '/admin/drivers', icon: Bus, label: t('admin.drivers'), count: kpis.drivers, light: 'bg-amber-50 text-amber-600' },
  ].filter(Boolean) as { to: string; icon: React.ElementType; label: string; count: number; light: string }[];

  // ── Needs your attention ──
  const attnRows = [
    has('academics.oversee') && attn.grades > 0 && { to: '/admin/grade-review', icon: Star, label: t('admin.cockpit.pending_grades', 'Grades awaiting release'), count: attn.grades },
    has('students.manage') && attn.appointments > 0 && { to: '/admin/appointments', icon: CalendarClock, label: t('admin.cockpit.pending_appointments', 'Appointment requests'), count: attn.appointments },
    has('accounts.manage') && attn.resets > 0 && { to: '/admin/accounts', icon: KeyRound, label: t('admin.cockpit.reset_requests', 'Password reset requests'), count: attn.resets },
    has('hr.read') && attn.expiring > 0 && { to: '/admin/employees', icon: FileWarning, label: t('admin.cockpit.expiring_docs', 'Documents expiring soon'), count: attn.expiring },
    has('transfers.manage') && attn.transfers > 0 && { to: '/admin/transfers', icon: ArrowLeftRight, label: t('admin.cockpit.incoming_transfers', 'Incoming transfers'), count: attn.transfers },
  ].filter(Boolean) as { to: string; icon: React.ElementType; label: string; count: number }[];

  // ── Quick links (capability-filtered) ──
  const quickLinks = [
    has('students.manage') && { to: '/admin/students', label: t('admin.manage_students'), desc: t('admin.manage_students_desc') },
    has('staff.manage') && { to: '/admin/employees', label: t('admin.manage_employees'), desc: t('admin.manage_employees_desc') },
    has('staff.manage') && { to: '/admin/drivers', label: t('admin.manage_drivers'), desc: t('admin.manage_drivers_desc') },
    has('accounts.manage') && { to: '/admin/accounts', label: t('admin.create_account'), desc: t('admin.create_account_desc') },
    has('students.manage') && { to: '/admin/appointments', label: t('nav.appointments'), desc: t('admin.appointments_desc') },
    has('academics.oversee') && { to: '/admin/classes', label: t('admin.classes'), desc: t('admin.classes_desc') },
    has('announcements.moderate') && { to: '/admin/announcements', label: t('nav.announcements'), desc: t('admin.announcements_desc') },
  ].filter(Boolean) as { to: string; label: string; desc: string }[];

  const showFinance = has('finance.read') && finance && (finance.monthByCurrency.length > 0 || finance.arByCurrency.length > 0 || finance.arStudentCount > 0);

  return (
    <PageLayout title={t('admin.dashboard_title')} subtitle={t('admin.welcome', { name: user?.firstName })}>
      <div className="space-y-6">
        {/* Search — press Enter to search students */}
        {has('enrollment.read') && (
          <form
            className="max-w-md flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              if (search.trim()) navigate(`/admin/list/students?search=${encodeURIComponent(search.trim())}`);
            }}
          >
            <div className="flex-1">
              <Input
                placeholder={t('admin.search_students_ph')}
                icon={<Search className="w-4 h-4" />}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {search.trim() && (
              <button
                type="submit"
                className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-colors whitespace-nowrap"
              >
                {t('common.search')} <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </form>
        )}

        {/* KPI strip */}
        {kpiCards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {kpiCards.map(({ to, icon: Icon, label, count, light }) => (
              <Link key={label} to={to}>
                <Card hover>
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${light}`}><Icon className="w-6 h-6" /></div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{count}</p>
                      <p className="text-sm text-gray-500">{label}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Needs your attention */}
        {attnRows.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {t('admin.cockpit.attention', 'Needs your attention')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {attnRows.map(({ to, icon: Icon, label, count }) => (
                <Link key={label} to={to}>
                  <Card hover>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-5 h-5 text-amber-600 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{label}</span>
                      </div>
                      <span className="text-lg font-bold text-gray-900">{count}</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Finance (Owner read-only) + Recent activity (audit.read) */}
        {(showFinance || (has('audit.read') && audit.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {showFinance && finance && (
              <Card>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary-600" /> {t('admin.cockpit.finance', 'Finance (this month)')}
                </h3>
                <div className="space-y-2">
                  {finance.monthByCurrency.map(m => (
                    <div key={`net-${m.currency}`} className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{t('admin.cockpit.net', 'Net')} ({m.currency})</span>
                      <span className={`font-semibold ${m.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(m.net, m.currency)}</span>
                    </div>
                  ))}
                  {finance.arByCurrency.map(a => (
                    <div key={`ar-${a.currency}`} className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{t('admin.cockpit.outstanding', 'Outstanding')} ({a.currency})</span>
                      <span className="font-semibold text-gray-900">{fmt(a.balance, a.currency)}</span>
                    </div>
                  ))}
                  {finance.arStudentCount > 0 && (
                    <div className="flex items-center justify-between text-sm pt-1 border-t border-gray-100">
                      <span className="text-gray-500">{t('admin.cockpit.overdue_students', 'Students with a balance')}</span>
                      <span className="font-semibold text-gray-900">{finance.arStudentCount}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-3">{t('admin.cockpit.finance_readonly', 'Read-only overview. Full accounting lives with the accountant.')}</p>
              </Card>
            )}

            {has('audit.read') && audit.length > 0 && (
              <Card>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <History className="w-5 h-5 text-gray-500" /> {t('admin.cockpit.recent_activity', 'Recent activity')}
                </h3>
                <ul className="space-y-2">
                  {audit.map(l => (
                    <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700 truncate">
                        {l.label || `${l.action ?? ''} ${l.entityType ?? ''}`.trim() || t('admin.cockpit.activity', 'activity')}
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {l.actorUsername ?? ''}{l.createdAt ? ` · ${new Date(l.createdAt).toLocaleDateString()}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link to="/admin/audit-log" className="text-xs text-primary-600 hover:underline mt-3 inline-block">
                  {t('admin.cockpit.view_audit', 'View audit log')} →
                </Link>
              </Card>
            )}
          </div>
        )}

        {/* Quick links */}
        {quickLinks.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('admin.management')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {quickLinks.map(({ to, label, desc }) => (
                <Link key={to} to={to}>
                  <Card hover>
                    <h3 className="font-semibold text-gray-900 mb-1">{label}</h3>
                    <p className="text-sm text-gray-500">{desc}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
