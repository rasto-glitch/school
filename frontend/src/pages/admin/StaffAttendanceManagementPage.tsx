import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  ClipboardCheck, AlertTriangle, CalendarOff, Settings as SettingsIcon,
  MapPin, Download, RefreshCw, Plus, Trash2, Clock, Crosshair, ShieldCheck,
} from 'lucide-react';
import { GoogleMap, useJsApiLoader, Marker, Circle } from '@react-google-maps/api';
import { staffAttendanceApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
// Fallback map centre when no pin is set yet (Baghdad) — only the initial view.
const DEFAULT_CENTER = { lat: 33.3152, lng: 44.3661 };
const LEAVE_TYPES = ['sick', 'vacation', 'personal', 'unpaid', 'official', 'other'] as const;

type Tab = 'today' | 'review' | 'leave' | 'settings';

interface PresentRow {
  attendanceId: string; userId: string; name: string; role: string; jobTitle: string | null;
  checkInAt: string | null; checkOutAt: string | null; status: string;
  isLate: boolean; flagged: boolean; flagReason: string | null;
}
interface AbsentRow { userId: string; name: string; role: string; jobTitle: string | null }
interface LeaveOnBoard {
  leaveId: string; userId: string; name: string; role: string; jobTitle: string | null;
  leaveType: string; startDate: string; endDate: string; note: string | null;
}
interface Board {
  date: string; isWorkingDay: boolean;
  schedule: { startTime: string; endTime: string; lateGraceMinutes: number };
  counts: { total: number; present: number; late: number; absent: number; onLeave: number };
  present: PresentRow[]; absent: AbsentRow[]; onLeave: LeaveOnBoard[];
}
interface ReviewRow {
  attendanceId: string; userId: string; name: string; role: string; jobTitle: string | null;
  workDate: string; checkInAt: string | null; checkOutAt: string | null; status: string;
  isLate: boolean; flagged: boolean; flagReason: string | null;
}
interface LeaveRow {
  id: string; userId: string; name: string; role: string; jobTitle: string | null;
  startDate: string; endDate: string; leaveType: string; note: string | null; createdAt: string;
}
interface EmployeeLite { id: string; name: string; role: string; jobTitle: string | null }
interface Config {
  provisioned: boolean; serverConfigured: boolean;
  geofence: { lat: number | null; lng: number | null; radiusMeters: number };
  schedule: { startTime: string; endTime: string; lateGraceMinutes: number };
}

// ── time / date helpers (device-local display) ───────────────────────────────
function todayStr(): string {
  // en-CA renders as YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA');
}
function firstOfMonthStr(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function downloadBlob(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function StaffAttendanceManagementPage() {
  const { t } = useTranslation();
  const { school, user } = useAuthStore() as any;
  const featureOn = school?.features?.staff_attendance === true;
  const clearance = user?.clearance;
  const canManage = !clearance
    || clearance.isOwner
    || (clearance.capabilities ?? []).includes('staff_attendance.manage');

  const [tab, setTab] = useState<Tab>('today');

  const roleLabel = useCallback((role: string, jobTitle: string | null) => {
    if (role === 'staff' && jobTitle) return jobTitle;
    return t(`nav.${role}`, role.charAt(0).toUpperCase() + role.slice(1));
  }, [t]);

  const leaveTypeLabel = useCallback(
    (lt: string) => t(`staff_attendance.leave_type.${lt}`, lt),
    [t],
  );

  if (!featureOn) {
    return (
      <PageLayout title={t('staff_attendance.mgmt.title', 'Staff Attendance')}>
        <Card className="max-w-lg">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">{t('staff_attendance.mgmt.not_provisioned_title', 'Not included in your plan')}</h2>
          </div>
          <p className="text-sm text-gray-500">
            {t('staff_attendance.mgmt.not_provisioned_body', 'Staff attendance is a premium feature provisioned per school. Contact your platform administrator to enable it.')}
          </p>
        </Card>
      </PageLayout>
    );
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'today', label: t('staff_attendance.mgmt.tab_today', 'Today'), icon: ClipboardCheck },
    { key: 'review', label: t('staff_attendance.mgmt.tab_review', 'Review'), icon: AlertTriangle },
    { key: 'leave', label: t('staff_attendance.mgmt.tab_leave', 'Leave'), icon: CalendarOff },
    { key: 'settings', label: t('staff_attendance.mgmt.tab_settings', 'Settings'), icon: SettingsIcon },
  ];

  return (
    <PageLayout title={t('staff_attendance.mgmt.title', 'Staff Attendance')} subtitle={t('staff_attendance.mgmt.subtitle', 'Employee clock-in board, review and settings')}>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {!canManage ? (
        <Card className="max-w-lg">
          <p className="text-sm text-gray-500">{t('staff_attendance.mgmt.no_access', 'You do not have permission to manage staff attendance.')}</p>
        </Card>
      ) : (
        <>
          {tab === 'today' && <TodayTab roleLabel={roleLabel} leaveTypeLabel={leaveTypeLabel} />}
          {tab === 'review' && <ReviewTab roleLabel={roleLabel} />}
          {tab === 'leave' && <LeaveTab roleLabel={roleLabel} leaveTypeLabel={leaveTypeLabel} />}
          {tab === 'settings' && <SettingsTab />}
        </>
      )}
    </PageLayout>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TODAY — day board + count chips + CSV export
// ════════════════════════════════════════════════════════════════════════════
function TodayTab({ roleLabel, leaveTypeLabel }: {
  roleLabel: (r: string, j: string | null) => string;
  leaveTypeLabel: (lt: string) => string;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayStr());
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    staffAttendanceApi.getBoard(date)
      .then(r => setBoard(r.data))
      .catch((e: any) => toast.error(e.response?.data?.error || t('staff_attendance.mgmt.load_failed', 'Could not load the board.')))
      .finally(() => setLoading(false));
  }, [date, t]);

  useEffect(() => { load(); }, [load]);

  const doExport = async () => {
    if (to < from) { toast.error(t('staff_attendance.mgmt.bad_range', 'End date must be on or after the start date.')); return; }
    setExporting(true);
    try {
      const r = await staffAttendanceApi.exportCsv(from, to);
      downloadBlob(r.data, `staff-attendance_${from}_${to}.csv`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('staff_attendance.mgmt.export_failed', 'Export failed.'));
    } finally {
      setExporting(false);
    }
  };

  const chips = board ? [
    { label: t('staff_attendance.mgmt.present', 'Present'), value: board.counts.present, cls: 'bg-green-50 text-green-700' },
    { label: t('staff_attendance.mgmt.late', 'Late'), value: board.counts.late, cls: 'bg-amber-50 text-amber-700' },
    { label: t('staff_attendance.mgmt.absent', 'Absent'), value: board.counts.absent, cls: 'bg-red-50 text-red-700' },
    { label: t('staff_attendance.mgmt.on_leave', 'On leave'), value: board.counts.onLeave, cls: 'bg-blue-50 text-blue-700' },
  ] : [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.date', 'Date')}</label>
          <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} className="input-field text-sm" />
        </div>
        <Button variant="outline" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={load}>
          {t('staff_attendance.mgmt.refresh', 'Refresh')}
        </Button>
        <div className="flex-1" />
        {/* Export */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.from', 'From')}</label>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.to', 'To')}</label>
            <input type="date" value={to} max={todayStr()} onChange={e => setTo(e.target.value)} className="input-field text-sm" />
          </div>
          <Button variant="outline" size="sm" icon={<Download className="w-4 h-4" />} onClick={doExport} loading={exporting}>
            {t('staff_attendance.mgmt.export_csv', 'Export CSV')}
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !board ? null : (
        <>
          {/* Count chips */}
          <div className="flex flex-wrap gap-2">
            {chips.map(c => (
              <div key={c.label} className={`px-3 py-2 rounded-xl text-sm font-semibold ${c.cls}`}>
                {c.value} <span className="font-normal">{c.label}</span>
              </div>
            ))}
            {!board.isWorkingDay && (
              <div className="px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-500">
                {t('staff_attendance.mgmt.non_working_day', 'Non-working day')}
              </div>
            )}
          </div>

          {/* Present / checked-in */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-green-600" />
              {t('staff_attendance.mgmt.checked_in', 'Checked in')} ({board.present.length})
            </h3>
            {board.present.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">{t('staff_attendance.mgmt.nobody_yet', 'Nobody has checked in yet.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="py-2 pr-3 font-medium">{t('staff_attendance.mgmt.name', 'Name')}</th>
                      <th className="py-2 px-3 font-medium">{t('staff_attendance.mgmt.role', 'Role')}</th>
                      <th className="py-2 px-3 font-medium">{t('staff_attendance.mgmt.in', 'In')}</th>
                      <th className="py-2 px-3 font-medium">{t('staff_attendance.mgmt.out', 'Out')}</th>
                      <th className="py-2 pl-3 font-medium">{t('staff_attendance.mgmt.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.present.map(p => (
                      <tr key={p.attendanceId} className="border-t border-gray-100">
                        <td className="py-2 pr-3 font-medium text-gray-800">{p.name}</td>
                        <td className="py-2 px-3 text-gray-500">{roleLabel(p.role, p.jobTitle)}</td>
                        <td className="py-2 px-3 text-gray-700">{fmtTime(p.checkInAt)}</td>
                        <td className="py-2 px-3 text-gray-700">{fmtTime(p.checkOutAt)}</td>
                        <td className="py-2 pl-3">
                          <div className="flex flex-wrap gap-1">
                            {p.isLate && <Tag cls="bg-amber-50 text-amber-700">{t('staff_attendance.mgmt.late', 'Late')}</Tag>}
                            {p.status === 'open' && <Tag cls="bg-green-50 text-green-700">{t('staff_attendance.mgmt.in_progress', 'In')}</Tag>}
                            {p.status === 'closed' && <Tag cls="bg-gray-100 text-gray-600">{t('staff_attendance.mgmt.done', 'Out')}</Tag>}
                            {p.status === 'auto_closed' && <Tag cls="bg-orange-50 text-orange-700">{t('staff_attendance.mgmt.auto_closed', 'Auto')}</Tag>}
                            {p.flagged && <Tag cls="bg-red-50 text-red-700">{t('staff_attendance.mgmt.flagged', 'Flag')}</Tag>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Absent */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              {t('staff_attendance.mgmt.absent', 'Absent')} ({board.absent.length})
            </h3>
            {!board.isWorkingDay ? (
              <p className="text-sm text-gray-400 py-2">{t('staff_attendance.mgmt.non_working_day', 'Non-working day')}</p>
            ) : board.absent.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">{t('staff_attendance.mgmt.all_accounted', 'Everyone is accounted for.')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {board.absent.map(a => (
                  <div key={a.userId} className="px-3 py-1.5 rounded-lg bg-gray-50 text-sm text-gray-700">
                    {a.name} <span className="text-gray-400">· {roleLabel(a.role, a.jobTitle)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* On leave */}
          {board.onLeave.length > 0 && (
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <CalendarOff className="w-4 h-4 text-blue-500" />
                {t('staff_attendance.mgmt.on_leave', 'On leave')} ({board.onLeave.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {board.onLeave.map(l => (
                  <div key={l.leaveId} className="px-3 py-1.5 rounded-lg bg-blue-50 text-sm text-blue-800">
                    {l.name} <span className="text-blue-400">· {leaveTypeLabel(l.leaveType)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REVIEW — flagged / auto-closed rows + correction modal
// ════════════════════════════════════════════════════════════════════════════
function ReviewTab({ roleLabel }: { roleLabel: (r: string, j: string | null) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReviewRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    staffAttendanceApi.getReview()
      .then(r => setRows(r.data?.rows ?? []))
      .catch((e: any) => toast.error(e.response?.data?.error || t('staff_attendance.mgmt.load_failed', 'Could not load the review queue.')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="w-8 h-8" />}
        title={t('staff_attendance.mgmt.review_empty_title', 'Nothing to review')}
        description={t('staff_attendance.mgmt.review_empty_body', 'Flagged and auto-closed punches will appear here.')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map(r => (
        <Card key={r.attendanceId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[160px]">
            <div className="font-medium text-gray-800">{r.name}</div>
            <div className="text-xs text-gray-400">{roleLabel(r.role, r.jobTitle)} · {r.workDate}</div>
          </div>
          <div className="text-sm text-gray-600">
            {t('staff_attendance.mgmt.in', 'In')}: {fmtTime(r.checkInAt)} · {t('staff_attendance.mgmt.out', 'Out')}: {fmtTime(r.checkOutAt)}
          </div>
          <div className="flex flex-wrap gap-1">
            {r.status === 'auto_closed' && <Tag cls="bg-orange-50 text-orange-700">{t('staff_attendance.mgmt.auto_closed_full', 'Auto-closed')}</Tag>}
            {r.flagged && <Tag cls="bg-red-50 text-red-700">{r.flagReason || t('staff_attendance.mgmt.flagged', 'Flagged')}</Tag>}
            {r.isLate && <Tag cls="bg-amber-50 text-amber-700">{t('staff_attendance.mgmt.late', 'Late')}</Tag>}
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
            {t('staff_attendance.mgmt.correct', 'Correct')}
          </Button>
        </Card>
      ))}

      {editing && (
        <CorrectionModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CorrectionModal({ row, onClose, onSaved }: { row: ReviewRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [checkIn, setCheckIn] = useState(toLocalInput(row.checkInAt));
  const [checkOut, setCheckOut] = useState(toLocalInput(row.checkOutAt));
  const [status, setStatus] = useState<'open' | 'closed' | 'auto_closed'>(row.status as any);
  const [isLate, setIsLate] = useState(row.isLate);
  const [resolveFlag, setResolveFlag] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const origIn = toLocalInput(row.checkInAt);
  const origOut = toLocalInput(row.checkOutAt);
  const changed =
    checkIn !== origIn || checkOut !== origOut ||
    status !== row.status || isLate !== row.isLate || resolveFlag;

  const save = async () => {
    if (!note.trim()) { toast.error(t('staff_attendance.mgmt.note_required', 'A note is required.')); return; }
    if (!changed) { toast.error(t('staff_attendance.mgmt.no_change', 'Change at least one field.')); return; }
    const payload: Parameters<typeof staffAttendanceApi.correct>[1] = { note: note.trim() };
    if (checkIn !== origIn) payload.checkInAt = fromLocalInput(checkIn);
    if (checkOut !== origOut) payload.checkOutAt = fromLocalInput(checkOut);
    if (status !== row.status) payload.status = status;
    if (isLate !== row.isLate) payload.isLate = isLate;
    if (resolveFlag) payload.resolveFlag = true;
    setSaving(true);
    try {
      await staffAttendanceApi.correct(row.attendanceId, payload);
      toast.success(t('staff_attendance.mgmt.correction_saved', 'Correction saved.'));
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('staff_attendance.mgmt.save_failed', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = [
    { value: 'open', label: t('staff_attendance.mgmt.status_open', 'Open (checked in)') },
    { value: 'closed', label: t('staff_attendance.mgmt.status_closed', 'Closed (checked out)') },
    { value: 'auto_closed', label: t('staff_attendance.mgmt.status_auto', 'Auto-closed') },
  ];

  return (
    <Modal isOpen onClose={onClose} title={`${t('staff_attendance.mgmt.correct', 'Correct')} — ${row.name}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff_attendance.mgmt.check_in', 'Check-in')}</label>
            <input type="datetime-local" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff_attendance.mgmt.check_out', 'Check-out')}</label>
            <input type="datetime-local" value={checkOut} onChange={e => setCheckOut(e.target.value)} className="input-field w-full text-sm" />
          </div>
        </div>
        <Select
          label={t('staff_attendance.mgmt.status', 'Status')}
          options={statusOptions}
          value={status}
          onChange={e => setStatus(e.target.value as any)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isLate} onChange={e => setIsLate(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          {t('staff_attendance.mgmt.mark_late', 'Marked late')}
        </label>
        {row.flagged && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={resolveFlag} onChange={e => setResolveFlag(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            {t('staff_attendance.mgmt.clear_flag', 'Mark as reviewed (clear flag)')}
          </label>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff_attendance.mgmt.note', 'Note')} *</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder={t('staff_attendance.mgmt.note_ph', 'Why this was changed (kept in the audit log)')}
            className="input-field w-full text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('staff_attendance.mgmt.cancel', 'Cancel')}</Button>
          <Button onClick={save} loading={saving} disabled={!note.trim() || !changed}>
            {t('staff_attendance.mgmt.save', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LEAVE — list + add + delete
// ════════════════════════════════════════════════════════════════════════════
function LeaveTab({ roleLabel, leaveTypeLabel }: {
  roleLabel: (r: string, j: string | null) => string;
  leaveTypeLabel: (lt: string) => string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    staffAttendanceApi.getLeave()
      .then(r => setRows(r.data?.leave ?? []))
      .catch((e: any) => toast.error(e.response?.data?.error || t('staff_attendance.mgmt.load_failed', 'Could not load leave.')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm(t('staff_attendance.mgmt.confirm_delete_leave', 'Remove this leave marker?'))) return;
    try {
      await staffAttendanceApi.deleteLeave(id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('staff_attendance.mgmt.save_failed', 'Could not remove.'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{t('staff_attendance.mgmt.leave_hint', 'Current and upcoming leave. People on leave count as on-leave (not absent) on the board.')}</p>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
          {t('staff_attendance.mgmt.add_leave', 'Add leave')}
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarOff className="w-8 h-8" />}
          title={t('staff_attendance.mgmt.leave_empty_title', 'No leave scheduled')}
          description={t('staff_attendance.mgmt.leave_empty_body', 'Add a leave marker for an employee who will be away.')}
        />
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <Card key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="min-w-[150px]">
                <div className="font-medium text-gray-800">{r.name}</div>
                <div className="text-xs text-gray-400">{roleLabel(r.role, r.jobTitle)}</div>
              </div>
              <div className="text-sm text-gray-600">{r.startDate} → {r.endDate}</div>
              <Tag cls="bg-blue-50 text-blue-700">{leaveTypeLabel(r.leaveType)}</Tag>
              {r.note && <div className="text-sm text-gray-400 truncate max-w-[220px]">{r.note}</div>}
              <div className="flex-1" />
              <button onClick={() => remove(r.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {adding && <AddLeaveModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddLeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [leaveType, setLeaveType] = useState<string>('sick');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    staffAttendanceApi.getEmployees()
      .then(r => setEmployees(r.data?.employees ?? []))
      .catch(() => {});
  }, []);

  const empOptions = useMemo(
    () => employees.map(e => ({ value: e.id, label: e.role === 'staff' && e.jobTitle ? `${e.name} (${e.jobTitle})` : e.name })),
    [employees],
  );
  const typeOptions = LEAVE_TYPES.map(lt => ({ value: lt, label: t(`staff_attendance.leave_type.${lt}`, lt) }));

  const save = async () => {
    if (!userId) { toast.error(t('staff_attendance.mgmt.pick_employee', 'Pick an employee.')); return; }
    if (endDate < startDate) { toast.error(t('staff_attendance.mgmt.bad_range', 'End date must be on or after the start date.')); return; }
    setSaving(true);
    try {
      await staffAttendanceApi.createLeave({ userId, startDate, endDate, leaveType, note: note.trim() || null });
      toast.success(t('staff_attendance.mgmt.leave_added', 'Leave added.'));
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('staff_attendance.mgmt.save_failed', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('staff_attendance.mgmt.add_leave', 'Add leave')} size="lg">
      <div className="space-y-4">
        <Select
          label={t('staff_attendance.mgmt.employee', 'Employee')}
          options={empOptions}
          value={userId}
          onChange={e => setUserId(e.target.value)}
          placeholder={t('staff_attendance.mgmt.select_employee', 'Select an employee…')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff_attendance.mgmt.start_date', 'Start date')}</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff_attendance.mgmt.end_date', 'End date')}</label>
            <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="input-field w-full text-sm" />
          </div>
        </div>
        <Select
          label={t('staff_attendance.mgmt.leave_type_label', 'Type')}
          options={typeOptions}
          value={leaveType}
          onChange={e => setLeaveType(e.target.value)}
        />
        <Input
          label={t('staff_attendance.mgmt.note', 'Note')}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t('staff_attendance.mgmt.optional', 'Optional')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('staff_attendance.mgmt.cancel', 'Cancel')}</Button>
          <Button onClick={save} loading={saving} disabled={!userId}>{t('staff_attendance.mgmt.add', 'Add')}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS — geofence pin (map) + radius + schedule (NO enable toggle: premium)
// ════════════════════════════════════════════════════════════════════════════
function SettingsTab() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('250');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('15:00');
  const [grace, setGrace] = useState('15');

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_API_KEY });

  useEffect(() => {
    staffAttendanceApi.getConfig()
      .then(r => {
        const c: Config = r.data;
        setCfg(c);
        if (c.geofence.lat != null) setLat(String(c.geofence.lat));
        if (c.geofence.lng != null) setLng(String(c.geofence.lng));
        setRadius(String(c.geofence.radiusMeters ?? 250));
        setStartTime(c.schedule.startTime);
        setEndTime(c.schedule.endTime);
        setGrace(String(c.schedule.lateGraceMinutes));
      })
      .catch((e: any) => toast.error(e.response?.data?.error || t('staff_attendance.mgmt.load_failed', 'Could not load settings.')))
      .finally(() => setLoading(false));
  }, [t]);

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const hasPin = Number.isFinite(latNum) && Number.isFinite(lngNum);
  const center = hasPin ? { lat: latNum, lng: lngNum } : DEFAULT_CENTER;
  const radiusNum = Math.max(50, Math.min(5000, parseInt(radius, 10) || 250));

  const setPin = (la: number, ln: number) => {
    setLat(la.toFixed(6));
    setLng(ln.toFixed(6));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error(t('staff_attendance.mgmt.no_geo', 'Geolocation is not available.')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setPin(pos.coords.latitude, pos.coords.longitude),
      () => toast.error(t('staff_attendance.mgmt.geo_denied', 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const save = async () => {
    if (!hasPin) { toast.error(t('staff_attendance.mgmt.pin_required', 'Drop the school location pin first.')); return; }
    if (endTime <= startTime) { toast.error(t('staff_attendance.mgmt.bad_schedule', 'End of day must be after the start time.')); return; }
    setSaving(true);
    try {
      const r = await staffAttendanceApi.updateConfig({
        geofence: { lat: latNum, lng: lngNum, radiusMeters: radiusNum },
        schedule: { startTime, endTime, lateGraceMinutes: Math.max(0, Math.min(180, parseInt(grace, 10) || 0)) },
      });
      setCfg(r.data);
      toast.success(t('staff_attendance.mgmt.settings_saved', 'Settings saved.'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('staff_attendance.mgmt.save_failed', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl space-y-5">
      {cfg && !cfg.serverConfigured && (
        <Card className="bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-800">
            {t('staff_attendance.mgmt.server_unconfigured', 'The QR signing secret is not set on the server yet, so scanning is disabled until the platform configures it.')}
          </p>
        </Card>
      )}

      {/* Geofence */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-5 h-5 text-primary-600" />
          <h2 className="font-semibold text-gray-900">{t('staff_attendance.mgmt.location', 'School location')}</h2>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          {t('staff_attendance.mgmt.location_hint', 'Tap the map to set the centre employees must be near to clock in. Scanning is rejected outside the radius.')}
        </p>

        <div className="rounded-xl overflow-hidden border border-gray-200 h-[300px] mb-3">
          {!MAPS_API_KEY ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 px-4 text-center">
              {t('staff_attendance.mgmt.no_map', 'Map unavailable — enter coordinates manually below.')}
            </div>
          ) : !isLoaded ? (
            <LoadingSpinner />
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={center}
              zoom={hasPin ? 16 : 12}
              onClick={e => { if (e.latLng) setPin(e.latLng.lat(), e.latLng.lng()); }}
            >
              {hasPin && <Marker position={center} />}
              {hasPin && (
                <Circle
                  center={center}
                  radius={radiusNum}
                  options={{ fillColor: '#4F46E5', fillOpacity: 0.12, strokeColor: '#4F46E5', strokeOpacity: 0.6, strokeWeight: 1 }}
                />
              )}
            </GoogleMap>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.lat', 'Latitude')}</label>
            <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.lng', 'Longitude')}</label>
            <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.radius', 'Radius (m)')}</label>
            <input type="number" min={50} max={5000} value={radius} onChange={e => setRadius(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <Button variant="outline" size="sm" icon={<Crosshair className="w-4 h-4" />} onClick={useMyLocation}>
            {t('staff_attendance.mgmt.use_my_location', 'Use my location')}
          </Button>
        </div>
      </Card>

      {/* Schedule */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-gray-900">{t('staff_attendance.mgmt.schedule', 'Work schedule')}</h2>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          {t('staff_attendance.mgmt.schedule_hint', 'School-wide hours. Check-ins after the start time plus the grace window are marked late.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.start_time', 'Start of day')}</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.end_time', 'End of day')}</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('staff_attendance.mgmt.grace', 'Late grace (min)')}</label>
            <input type="number" min={0} max={180} value={grace} onChange={e => setGrace(e.target.value)} className="input-field w-full text-sm" />
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} icon={<SettingsIcon className="w-4 h-4" />}>
          {t('staff_attendance.mgmt.save_settings', 'Save settings')}
        </Button>
      </div>
    </div>
  );
}

// Small pill.
function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}
