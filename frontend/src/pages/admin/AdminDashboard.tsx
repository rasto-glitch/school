import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap, Users, Bus, Star, CalendarClock, KeyRound,
  FileWarning, ArrowLeftRight, Wallet, TrendingUp,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';

// Admin dashboard "oversight cockpit" (Phase C2, refined C3). Every region is
// gated on the viewer's capability and curated per clearance: an Owner sees
// the finance KPIs + fee-collection + audit; an Operations admin sees the
// student/staff KPIs and only the attention items they can act on; finance
// regions collapse entirely without finance.read. Data is fetched only when
// the capability is held, so a scoped admin never hits a 403.

interface FinanceOverview {
  defaultCurrency: string;
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

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
const money = (n: number, ccy: string) => {
  const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(n));
  return SYMBOL[ccy] ? `${SYMBOL[ccy]}${num}` : `${num} ${ccy}`;
};

// Compact relative time: "5m" / "3h" / "2d".
function ago(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Owner sees all; missing clearance (legacy session) also falls back to all
  // since the server re-enforces every route anyway.
  const clearance = user?.clearance;
  const has = (cap: string) => !clearance || clearance.isOwner || clearance.capabilities.includes(cap);

  const [students, setStudents] = useState({ total: 0, newThisMonth: 0 });
  const [staff, setStaff] = useState({ teachers: 0, drivers: 0 });
  const [attn, setAttn] = useState({ grades: 0, appointments: 0, resets: 0, expiring: 0, transfers: 0 });
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);

  useEffect(() => {
    const run = async () => {
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
      const firstOfMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); })();

      if (has('enrollment.read')) {
        const s = await safe(adminApi.getStudents());
        const rows: { createdAt?: string }[] = s?.data?.students ?? [];
        const total = s?.data?.total ?? rows.length;
        const newThisMonth = rows.filter(r => r.createdAt && new Date(r.createdAt).getTime() >= firstOfMonth).length;
        setStudents({ total, newThisMonth });
      }
      if (has('staff.manage')) {
        const [tch, drv] = await Promise.all([safe(adminApi.getTeachers('list')), safe(adminApi.getDrivers())]);
        setStaff({ teachers: tch?.data?.length || 0, drivers: drv?.data?.length || 0 });
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
        const a = await safe(adminApi.getAuditLogs({ limit: 5 }));
        setAudit((a?.data?.logs ?? []) as AuditLog[]);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Finance figures (default currency) ──
  const ccy = finance?.defaultCurrency ?? 'USD';
  const collected = finance?.monthByCurrency.find(m => m.currency === ccy)?.income ?? finance?.monthByCurrency[0]?.income ?? 0;
  const outstanding = finance?.arByCurrency.find(a => a.currency === ccy)?.balance ?? finance?.arByCurrency[0]?.balance ?? 0;
  const pctCollected = collected + outstanding > 0 ? Math.round((collected / (collected + outstanding)) * 100) : 0;
  const monthLabel = new Date().toLocaleDateString(i18n.language, { month: 'short' });
  const showFinance = has('finance.read') && finance !== null;

  // ── KPI strip (curated per clearance) ──
  type Kpi = { key: string; label: string; value: string; sub: string; subTone: string; icon: React.ElementType; tint: string; to?: string };
  const kpis: Kpi[] = [];
  if (has('enrollment.read')) kpis.push({
    key: 'students', label: t('admin.students'), value: String(students.total),
    sub: students.newThisMonth > 0 ? t('admin.cockpit.new_this_month', { count: students.newThisMonth, defaultValue: '↑ +{{count}} this month' }) : t('admin.cockpit.enrolled', 'enrolled'),
    subTone: students.newThisMonth > 0 ? 'text-green-600' : 'text-gray-400',
    icon: GraduationCap, tint: 'bg-blue-50 text-blue-600', to: '/admin/students',
  });
  if (has('staff.manage')) kpis.push({
    key: 'teachers', label: t('admin.teachers'), value: String(staff.teachers),
    sub: t('admin.cockpit.drivers_count', { count: staff.drivers, defaultValue: '{{count}} drivers' }),
    subTone: 'text-gray-400', icon: Users, tint: 'bg-green-50 text-green-600', to: '/admin/employees',
  });
  if (showFinance) {
    kpis.push({
      key: 'collected', label: `${t('admin.cockpit.collected', 'Collected')} · ${monthLabel}`, value: money(collected, ccy),
      sub: t('admin.cockpit.pct_collected', { pct: pctCollected, defaultValue: '{{pct}}% collected' }),
      subTone: 'text-green-600', icon: TrendingUp, tint: 'bg-emerald-50 text-emerald-600',
    });
    kpis.push({
      key: 'outstanding', label: t('admin.cockpit.outstanding', 'Outstanding'), value: money(outstanding, ccy),
      sub: finance!.arStudentCount > 0 ? t('admin.cockpit.n_overdue', { count: finance!.arStudentCount, defaultValue: '{{count}} overdue' }) : t('admin.cockpit.all_settled', 'all settled'),
      subTone: finance!.arStudentCount > 0 ? 'text-amber-600' : 'text-gray-400', icon: Wallet, tint: 'bg-amber-50 text-amber-600',
    });
  } else if (has('staff.manage')) {
    kpis.push({
      key: 'drivers', label: t('admin.drivers'), value: String(staff.drivers),
      sub: t('admin.cockpit.transport', 'transport'), subTone: 'text-gray-400',
      icon: Bus, tint: 'bg-amber-50 text-amber-600', to: '/admin/drivers',
    });
  }

  // ── Needs your attention (real signals, capability-gated) ──
  type Item = { key: string; title: string; sub: string; action: string; to: string; tint: string };
  const items: Item[] = [];
  if (has('academics.oversee') && attn.grades > 0) items.push({
    key: 'grades', title: t('admin.cockpit.grades_title', { count: attn.grades, defaultValue: '{{count}} grades awaiting release' }),
    sub: t('admin.cockpit.grades_sub', 'Term reports pending review'), action: t('admin.cockpit.act_review', 'Review'),
    to: '/admin/grade-review', tint: 'bg-amber-100',
  });
  if (has('students.manage') && attn.appointments > 0) items.push({
    key: 'appointments', title: t('admin.cockpit.appts_title', { count: attn.appointments, defaultValue: '{{count}} appointment requests' }),
    sub: t('admin.cockpit.appts_sub', 'Parents awaiting a reply'), action: t('admin.cockpit.act_open', 'Open'),
    to: '/admin/appointments', tint: 'bg-blue-100',
  });
  if (has('accounts.manage') && attn.resets > 0) items.push({
    key: 'resets', title: t('admin.cockpit.resets_title', { count: attn.resets, defaultValue: '{{count}} account requests pending' }),
    sub: t('admin.cockpit.resets_sub', 'Password reset queue'), action: t('admin.cockpit.act_review', 'Review'),
    to: '/admin/accounts', tint: 'bg-violet-100',
  });
  if (has('hr.read') && attn.expiring > 0) items.push({
    key: 'expiring', title: t('admin.cockpit.expiring_title', { count: attn.expiring, defaultValue: '{{count}} documents expiring soon' }),
    sub: t('admin.cockpit.expiring_sub', 'Within the next 30 days'), action: t('admin.cockpit.act_view', 'View'),
    to: '/admin/employees', tint: 'bg-rose-100',
  });
  if (has('transfers.manage') && attn.transfers > 0) items.push({
    key: 'transfers', title: t('admin.cockpit.transfers_title', { count: attn.transfers, defaultValue: '{{count}} incoming transfers' }),
    sub: t('admin.cockpit.transfers_sub', 'Awaiting your review'), action: t('admin.cockpit.act_review', 'Review'),
    to: '/admin/transfers', tint: 'bg-blue-100',
  });

  const dateLabel = new Date().toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const hasRightRail = showFinance || (has('audit.read') && audit.length > 0);

  return (
    <PageLayout title={t('admin.dashboard_title')} subtitle={`${t('admin.welcome', { name: user?.firstName })} · ${dateLabel}`}>
      <div className="space-y-5">
        {/* KPI strip */}
        {kpis.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map(k => {
              const Inner = (
                <Card hover={!!k.to} className="h-full">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{k.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{k.value}</p>
                      <p className={`text-xs mt-1 ${k.subTone}`}>{k.sub}</p>
                    </div>
                    <div className={`p-2 rounded-lg ${k.tint}`}><k.icon className="w-5 h-5" /></div>
                  </div>
                </Card>
              );
              return k.to
                ? <button key={k.key} onClick={() => navigate(k.to!)} className="text-start">{Inner}</button>
                : <div key={k.key}>{Inner}</div>;
            })}
          </div>
        )}

        <div className={`grid grid-cols-1 gap-4 ${hasRightRail ? 'lg:grid-cols-3' : ''}`}>
          {/* Needs your attention */}
          <div className={hasRightRail ? 'lg:col-span-2' : ''}>
            <Card className="h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">{t('admin.cockpit.attention', 'Needs your attention')}</h2>
                <span className="text-xs text-gray-400">{t('admin.cockpit.n_items', { count: items.length, defaultValue: '{{count}} items' })}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">{t('admin.cockpit.all_clear', 'Nothing needs your attention right now.')}</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {items.map(it => (
                    <li key={it.key} className="flex items-center gap-3 py-3">
                      <span className={`w-7 h-7 rounded-md flex-shrink-0 ${it.tint}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{it.title}</p>
                        <p className="text-xs text-gray-500 truncate">{it.sub}</p>
                      </div>
                      <button
                        onClick={() => navigate(it.to)}
                        className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        {it.action}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Right rail: fee collection + audit highlights */}
          {hasRightRail && (
            <div className="space-y-4">
              {showFinance && (
                <Card>
                  <h3 className="font-semibold text-gray-900 mb-3">{t('admin.cockpit.fee_collection', 'Fee collection')}</h3>
                  <div className="h-2.5 rounded-full bg-amber-400 overflow-hidden flex">
                    <div className="h-full bg-emerald-500" style={{ width: `${pctCollected}%` }} />
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{t('admin.cockpit.collected', 'Collected')}</span>
                      <span className="font-semibold text-gray-900">{money(collected, ccy)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-full bg-amber-400" />{t('admin.cockpit.outstanding', 'Outstanding')}</span>
                      <span className="font-semibold text-gray-900">{money(outstanding, ccy)}</span>
                    </div>
                  </div>
                  {finance!.arStudentCount > 0 && (
                    <p className="text-xs text-amber-600 mt-3">{t('admin.cockpit.overdue_note', { count: finance!.arStudentCount, defaultValue: '{{count}} accounts 30+ days overdue' })}</p>
                  )}
                </Card>
              )}

              {has('audit.read') && audit.length > 0 && (
                <Card>
                  <h3 className="font-semibold text-gray-900 mb-3">{t('admin.cockpit.audit_highlights', 'Audit highlights')}</h3>
                  <ul className="space-y-2.5">
                    {audit.map(l => (
                      <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-700 truncate">
                          {l.label || `${l.action ?? ''} ${l.entityType ?? ''}`.trim() || t('admin.cockpit.activity', 'activity')}
                        </span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{ago(l.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
