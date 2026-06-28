import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  GraduationCap, Users, Bus, Wallet, TrendingUp,
  ClipboardX, FileWarning, FileCheck, FileClock, CalendarClock, CalendarDays,
  UserPlus, ShieldAlert, Loader2, Check,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import SetGradeWindowModal from '../../components/admin/SetGradeWindowModal';

// Admin dashboard "oversight cockpit" (Phase C2 → C3). Every region is gated on
// the viewer's capability and curated per clearance: an Owner sees the finance
// KPIs + fee-collection + audit; an Operations admin sees the student/staff
// KPIs and only the attention items they can act on; finance regions collapse
// entirely without finance.read. Data is fetched only when the capability is
// held, so a scoped admin never hits a 403. The "Needs your attention" rows are
// real signals with real actions (Notify supervisors, Remind teachers, set a
// grade-filing window, inspect failed logins) — not just links.

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
interface GradeGap {
  state: 'none' | 'incomplete' | 'complete';
  window: { term: string; opensOn: string; closesOn: string } | null;
  gradable?: boolean;
  teacherCount: number;
  anyFiled: boolean;
  lastRemindedAt: string | null;
}
interface AttendanceGap {
  schoolDay: boolean;
  date: string;
  classes: { id: string; name: string }[];
  lastNotifiedAt: string | null;
}
interface AccountReq { total: number; byRole: Record<string, number> }
interface FailedLogins {
  alert: boolean;
  username?: string;
  count?: number;
  sameIp?: boolean;
  lastAt?: string;
  accounts?: number;
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

// True when an action was last fired within the server's 3h cooldown — used to
// pre-disable the Notify/Remind buttons with a "done" state on load.
function withinCooldown(iso?: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 3 * 60 * 60 * 1000;
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
  const [attn, setAttn] = useState({ grades: 0, appointments: 0, expiring: 0 });
  const [gradeGap, setGradeGap] = useState<GradeGap | null>(null);
  const [attendanceGap, setAttendanceGap] = useState<AttendanceGap | null>(null);
  const [accountReq, setAccountReq] = useState<AccountReq | null>(null);
  const [failedLogins, setFailedLogins] = useState<FailedLogins | null>(null);
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);

  // Per-action UI state (busy spinner / done check) + the set-window modal.
  const [acting, setActing] = useState<Record<string, 'busy' | 'done'>>({});
  const [windowModal, setWindowModal] = useState(false);

  const safe = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const reloadGradeGap = async () => {
    if (!has('academics.oversee')) return;
    const gap = await safe(adminApi.getGradeGap());
    if (gap?.data) setGradeGap(gap.data as GradeGap);
  };

  useEffect(() => {
    const run = async () => {
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
        const [g, ag, gap] = await Promise.all([
          safe(adminApi.getGradeReviewOverview()),
          safe(adminApi.getAttendanceGap()),
          safe(adminApi.getGradeGap()),
        ]);
        const pending = (g?.data?.classes ?? []).reduce((acc: number, c: { pendingCount?: number }) => acc + (c.pendingCount || 0), 0);
        setAttn(a => ({ ...a, grades: pending }));
        if (ag?.data) setAttendanceGap(ag.data as AttendanceGap);
        if (gap?.data) setGradeGap(gap.data as GradeGap);
      }
      if (has('students.manage')) {
        const ap = await safe(adminApi.getPendingAppointmentCount());
        setAttn(a => ({ ...a, appointments: ap?.data?.count || 0 }));
      }
      if (has('accounts.manage')) {
        const r = await safe(adminApi.getAccountRequestSummary());
        if (r?.data) setAccountReq(r.data as AccountReq);
      }
      if (has('hr.read')) {
        const e = await safe(adminApi.listExpiringEmployeeDocuments(30));
        setAttn(a => ({ ...a, expiring: e?.data?.total || 0 }));
      }
      if (has('finance.read')) {
        const f = await safe(adminApi.getFinanceOverview());
        if (f?.data) setFinance(f.data as FinanceOverview);
      }
      if (has('audit.read')) {
        const [a, fl] = await Promise.all([
          safe(adminApi.getAuditLogs({ limit: 5 })),
          safe(adminApi.getFailedLoginSummary()),
        ]);
        setAudit((a?.data?.logs ?? []) as AuditLog[]);
        if (fl?.data) setFailedLogins(fl.data as FailedLogins);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire a Notify/Remind action, with toast + busy/done state.
  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setActing(s => ({ ...s, [key]: 'busy' }));
    try {
      await fn();
      setActing(s => ({ ...s, [key]: 'done' }));
      toast.success(t('admin.cockpit.action_sent', 'Sent'));
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.cockpit.action_failed', "Couldn't complete that action."));
      setActing(s => { const c = { ...s }; delete c[key]; return c; });
    }
  };

  // Binary singular/plural picked in JS (i18next's per-language plural
  // categories are fragile for ar/ku); each locale supplies <role>_one /
  // <role>_other. Yields e.g. "2 parents, 1 teacher".
  const roleLabel = (role: string, n: number) => t(`roles.${role}_${n === 1 ? 'one' : 'other'}`, { defaultValue: role });
  const breakdown = (byRole: Record<string, number>) =>
    Object.entries(byRole)
      .filter(([, n]) => n > 0)
      .map(([role, n]) => `${n} ${roleLabel(role, n)}`)
      .join(', ');

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

  // ── Needs your attention (real signals + actions, capability-gated) ──
  type Item = {
    key: string;
    icon: React.ElementType;
    chip: string;                         // chip bg + text colour
    title: string;
    sub: string;
    action: { label: string; onClick: () => void };
    doneLabel?: string;                   // shown after the action fires / during cooldown
    actionKey?: string;                   // ties into `acting` + cooldown
  };
  const items: Item[] = [];

  // 1. Attendance — active classes with no attendance recorded today.
  if (has('academics.oversee') && attendanceGap?.schoolDay && attendanceGap.classes.length > 0) {
    const names = attendanceGap.classes.slice(0, 3).map(c => c.name).join(', ');
    const extra = attendanceGap.classes.length - 3;
    const sub = extra > 0
      ? t('admin.cockpit.attn_attendance_sub_more', { names, count: extra, defaultValue: '{{names}} +{{count}} more · supervisor task' })
      : t('admin.cockpit.attn_attendance_sub', { names, defaultValue: '{{names}} · supervisor task' });
    items.push({
      key: 'attendance', icon: ClipboardX, chip: 'bg-amber-50 text-amber-700',
      title: t('admin.cockpit.attn_attendance_title', { count: attendanceGap.classes.length, defaultValue: "{{count}} classes missing today's attendance" }),
      sub,
      actionKey: 'attendance',
      doneLabel: t('admin.cockpit.notified', 'Notified'),
      action: { label: t('admin.cockpit.act_notify', 'Notify'), onClick: () => runAction('attendance', () => adminApi.notifyAttendanceGap()) },
    });
  }

  // 2. Grade filing — window state machine.
  if (has('academics.oversee') && gradeGap) {
    if (gradeGap.state === 'none' && gradeGap.gradable) {
      items.push({
        key: 'grade-window', icon: CalendarClock, chip: 'bg-amber-50 text-amber-700',
        title: t('admin.cockpit.attn_window_title', 'Grade filing not scheduled'),
        sub: t('admin.cockpit.attn_window_sub', 'Set a window so teachers can submit grades'),
        action: { label: t('admin.cockpit.act_set_window', 'Set window'), onClick: () => setWindowModal(true) },
      });
    } else if (gradeGap.state === 'incomplete' && gradeGap.window) {
      const title = gradeGap.anyFiled
        ? t('admin.cockpit.attn_grades_title', { count: gradeGap.teacherCount, defaultValue: "{{count}} teachers haven't submitted grades" })
        : t('admin.cockpit.attn_grades_open_title', { count: gradeGap.teacherCount, defaultValue: 'Grades open — {{count}} teachers to file' });
      items.push({
        key: 'grade-gap', icon: FileWarning, chip: 'bg-amber-50 text-amber-700',
        title,
        sub: t('admin.cockpit.attn_grades_sub', { term: gradeGap.window.term, date: gradeGap.window.closesOn, defaultValue: '{{term}} · filing closes {{date}}' }),
        actionKey: 'grade-gap',
        doneLabel: t('admin.cockpit.reminded', 'Reminded'),
        action: { label: t('admin.cockpit.act_remind', 'Remind'), onClick: () => runAction('grade-gap', () => adminApi.remindGradeGap()) },
      });
    }
  }

  // 3. Grades awaiting release (teacher submissions pending admin review).
  if (has('academics.oversee') && attn.grades > 0) items.push({
    key: 'grades-release', icon: FileCheck, chip: 'bg-sky-50 text-sky-700',
    title: t('admin.cockpit.grades_title', { count: attn.grades, defaultValue: '{{count}} grades awaiting release' }),
    sub: t('admin.cockpit.grades_sub', 'Teacher submissions pending your review'),
    action: { label: t('admin.cockpit.act_review', 'Review'), onClick: () => navigate('/admin/grade-review') },
  });

  // 4. Appointment requests (students.manage).
  if (has('students.manage') && attn.appointments > 0) items.push({
    key: 'appointments', icon: CalendarDays, chip: 'bg-blue-50 text-blue-700',
    title: t('admin.cockpit.appts_title', { count: attn.appointments, defaultValue: '{{count}} appointment requests' }),
    sub: t('admin.cockpit.appts_sub', 'Parents awaiting a reply'),
    action: { label: t('admin.cockpit.act_open', 'Open'), onClick: () => navigate('/admin/appointments') },
  });

  // 5. Account requests — pending password resets, broken down by role.
  if (has('accounts.manage') && accountReq && accountReq.total > 0) {
    const bd = breakdown(accountReq.byRole);
    items.push({
      key: 'account-req', icon: UserPlus, chip: 'bg-indigo-50 text-indigo-700',
      title: t('admin.cockpit.resets_title', { count: accountReq.total, defaultValue: '{{count}} account requests pending' }),
      sub: bd || t('admin.cockpit.resets_sub', 'Password reset queue'),
      action: { label: t('admin.cockpit.act_review', 'Review'), onClick: () => navigate('/admin/accounts') },
    });
  }

  // 6. Expiring employee documents (hr.read).
  if (has('hr.read') && attn.expiring > 0) items.push({
    key: 'expiring', icon: FileClock, chip: 'bg-rose-50 text-rose-700',
    title: t('admin.cockpit.expiring_title', { count: attn.expiring, defaultValue: '{{count}} documents expiring soon' }),
    sub: t('admin.cockpit.expiring_sub', 'Within the next 30 days'),
    action: { label: t('admin.cockpit.act_view', 'View'), onClick: () => navigate('/admin/employees') },
  });

  // 7. Failed logins on an admin account (audit.read).
  if (has('audit.read') && failedLogins?.alert) {
    const when = ago(failedLogins.lastAt);
    const sub = failedLogins.sameIp
      ? t('admin.cockpit.attn_logins_sub_ip', { when, defaultValue: '{{when}} ago · same IP' })
      : t('admin.cockpit.attn_logins_sub', { when, count: failedLogins.accounts ?? 1, defaultValue: '{{when}} ago · {{count}} accounts' });
    items.push({
      key: 'failed-logins', icon: ShieldAlert, chip: 'bg-red-50 text-red-700',
      title: t('admin.cockpit.attn_logins_title', { count: failedLogins.count ?? 0, defaultValue: '{{count}} failed logins on an admin account' }),
      sub,
      action: { label: t('admin.cockpit.act_inspect', 'Inspect'), onClick: () => navigate('/admin/security') },
    });
  }

  const dateLabel = new Date().toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const hasRightRail = showFinance || (has('audit.read') && audit.length > 0);

  // Render the per-row action button: live action, or a disabled "done" state
  // once fired / while the server cooldown holds.
  const renderAction = (it: Item) => {
    const fired = it.actionKey ? acting[it.actionKey] : undefined;
    const cooled = it.key === 'attendance' ? withinCooldown(attendanceGap?.lastNotifiedAt)
      : it.key === 'grade-gap' ? withinCooldown(gradeGap?.lastRemindedAt)
      : false;
    if (fired === 'done' || (it.actionKey && cooled && fired !== 'busy')) {
      return (
        <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-emerald-700 bg-emerald-50">
          <Check className="w-3.5 h-3.5" />{it.doneLabel ?? t('admin.cockpit.done', 'Done')}
        </span>
      );
    }
    return (
      <button
        onClick={it.action.onClick}
        disabled={fired === 'busy'}
        className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {fired === 'busy' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {it.action.label}
      </button>
    );
  };

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
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${it.chip}`}>
                        <it.icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{it.title}</p>
                        <p className="text-xs text-gray-500 truncate">{it.sub}</p>
                      </div>
                      {renderAction(it)}
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

      <SetGradeWindowModal isOpen={windowModal} onClose={() => setWindowModal(false)} onSaved={reloadGradeGap} />
    </PageLayout>
  );
}
