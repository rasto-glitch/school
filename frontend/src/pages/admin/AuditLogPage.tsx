import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Search, ChevronDown, ChevronRight, Plus, Pencil, Trash2, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { format, parseISO } from 'date-fns';

interface AuditLog {
  id: string;
  schoolId: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  changes: Record<string, unknown>;
  actorId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  label: string | null;
  reason: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

const ENTITY_TYPES = [
  'student',
  'fee_plan',
  'student_fee',
  'fee_payment',
  'staff_member',
  'staff_salary_payment',
] as const;

const ACTIONS = ['create', 'update', 'delete'] as const;

const ACTION_STYLES: Record<string, { bg: string; text: string; Icon: typeof Plus }> = {
  create: { bg: 'bg-green-100', text: 'text-green-700', Icon: Plus },
  update: { bg: 'bg-blue-100', text: 'text-blue-700', Icon: Pencil },
  delete: { bg: 'bg-red-100', text: 'text-red-700', Icon: Trash2 },
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    // Detect ISO date / timestamp strings and humanize.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return format(d, 'MMM d, yyyy h:mm a');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(v + 'T00:00:00');
      if (!isNaN(d.getTime())) return format(d, 'MMM d, yyyy');
    }
  }
  return String(v);
}

// Convert camelCase or snake_case keys to "Sentence case".
function humanizeKey(k: string): string {
  const spaced = k.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const lower = spaced.toLowerCase().trim();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Friendly verbs for known boolean flags so a single flip reads as a status,
// not as `isActive Old true New false`.
const FLAG_LABELS: Record<string, { onTrue: string; onFalse: string }> = {
  isActive: { onTrue: 'Restored / activated', onFalse: 'Archived / deactivated' },
  isGraduated: { onTrue: 'Marked as graduated', onFalse: 'Marked as not graduated' },
  isPublished: { onTrue: 'Published', onFalse: 'Unpublished' },
  isOpen: { onTrue: 'Opened', onFalse: 'Closed' },
  isDeleted: { onTrue: 'Marked as deleted', onFalse: 'Restored' },
  isArchived: { onTrue: 'Archived', onFalse: 'Restored from archive' },
};

// Returns a one-line friendly sentence for a boolean flip, or null if the
// values aren't a boolean flip.
function flagFlipSentence(key: string, oldV: unknown, newV: unknown): string | null {
  if (typeof oldV !== 'boolean' || typeof newV !== 'boolean') return null;
  if (oldV === newV) return null;
  const labels = FLAG_LABELS[key];
  if (labels) return newV ? labels.onTrue : labels.onFalse;
  return `${humanizeKey(key)}: ${oldV ? 'Yes' : 'No'} → ${newV ? 'Yes' : 'No'}`;
}

// If an update boils down to a single recognized flag flip, return the
// friendly verb so the row header reads "Archived" instead of "Updated".
interface AuditLogLite {
  action: 'create' | 'update' | 'delete';
  changes: Record<string, unknown>;
}
interface LogSummary {
  text: string;
  bg: string;
  text_: string;
}
function summarizeLog(log: AuditLogLite): LogSummary | null {
  if (log.action !== 'update') return null;
  const entries = Object.entries(log.changes || {});
  if (entries.length !== 1) return null;
  const [k, v] = entries[0];
  const change = v as { old: unknown; new: unknown };
  const sentence = flagFlipSentence(k, change.old, change.new);
  if (!sentence) return null;
  const labels = FLAG_LABELS[k];
  if (!labels) return null;
  const newVal = change.new as boolean;
  return {
    text: newVal ? labels.onTrue : labels.onFalse,
    bg: newVal ? 'bg-emerald-100' : 'bg-rose-100',
    text_: newVal ? 'text-emerald-700' : 'text-rose-700',
  };
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    setLoading(true);
    adminApi.getAuditLogs({
      search: search || undefined,
      entityType: entityType || undefined,
      action: action || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59` : undefined,
      page,
      limit: PAGE_SIZE,
    })
      .then(r => {
        setLogs(r.data.logs || []);
        setTotal(r.data.total || 0);
      })
      .catch(() => {
        setLogs([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [search, entityType, action, from, to, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch('');
    setEntityType('');
    setAction('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const hasActiveFilter = search || entityType || action || from || to;

  return (
    <PageLayout title={t('audit.title')} subtitle={t('audit.subtitle')}>
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              placeholder={t('audit.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Select
            value={entityType}
            onChange={(e) => { setPage(1); setEntityType(e.target.value); }}
            options={[
              { value: '', label: t('audit.allEntities') },
              ...ENTITY_TYPES.map(et => ({ value: et, label: t(`audit.entity.${et}`) })),
            ]}
          />
          <Select
            value={action}
            onChange={(e) => { setPage(1); setAction(e.target.value); }}
            options={[
              { value: '', label: t('audit.allActions') },
              ...ACTIONS.map(a => ({ value: a, label: t(`audit.action.${a}`) })),
            ]}
          />
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
            <Input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
          </div>
        </div>
        {hasActiveFilter && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">{t('audit.totalResults', { count: total })}</span>
            <button onClick={resetFilters} className="flex items-center gap-1 text-primary-600 hover:bg-primary-50 px-2 py-1 rounded">
              <X className="w-3.5 h-3.5" /> {t('audit.clearFilters')}
            </button>
          </div>
        )}
      </Card>

      {loading ? (
        <LoadingSpinner />
      ) : logs.length === 0 ? (
        <EmptyState title={t('audit.noResults')} icon={<History className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const isOpen = expanded.has(log.id);
            const styles = ACTION_STYLES[log.action];
            const ActionIcon = styles.Icon;
            const summary = summarizeLog(log);
            return (
              <Card key={log.id} className="!p-0 overflow-hidden">
                <button onClick={() => toggle(log.id)} className="w-full flex items-start gap-3 p-4 hover:bg-gray-50 text-left">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${styles.bg}`}>
                    <ActionIcon className={`w-4 h-4 ${styles.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${summary ? `${summary.bg} ${summary.text_}` : `${styles.bg} ${styles.text}`}`}>
                        {summary ? summary.text : t(`audit.action.${log.action}`)}
                      </span>
                      <span className="text-sm text-gray-500">
                        {t(`audit.entity.${log.entityType}`)}
                      </span>
                      {log.label && <span className="text-sm font-semibold text-gray-900 truncate">· {log.label}</span>}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      <span className="font-medium text-gray-700">{log.actorUsername ?? t('audit.unknownActor')}</span>
                      {log.actorRole && <span className="text-gray-400"> ({log.actorRole})</span>}
                      <span className="mx-1">·</span>
                      <span>{format(parseISO(log.createdAt), 'MMM d, yyyy h:mm a')}</span>
                      {log.reason && <span className="ml-2 italic">— {log.reason}</span>}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <ChangesView log={log} />
                    <div className="mt-3 text-xs text-gray-400">
                      <span className="font-mono">id: {log.entityId}</span>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">{t('audit.pageOf', { page, totalPages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              {t('common.previous')}
            </Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function ChangesView({ log }: { log: AuditLog }) {
  const { t } = useTranslation();
  const entries = useMemo(() => {
    const c = log.changes || {};
    if ((log.action === 'create' || log.action === 'delete') && '_row' in c) {
      const row = (c as { _row: Record<string, unknown> })._row;
      return Object.entries(row);
    }
    return Object.entries(c);
  }, [log]);

  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 italic">{t('audit.noChanges')}</p>;
  }

  if (log.action === 'create' || log.action === 'delete') {
    return (
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {log.action === 'create' ? t('audit.created') : t('audit.deleted')}
        </div>
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2 text-sm">
            <span className="text-gray-600">{humanizeKey(k)}</span>
            <span className="col-span-2 text-gray-900 break-all">{formatValue(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Split entries into boolean-flip flags and regular field diffs so flips
  // can render as friendly status sentences instead of old/new pairs.
  const flips: { key: string; sentence: string; newVal: boolean }[] = [];
  const regular: [string, { old: unknown; new: unknown }][] = [];
  for (const [k, v] of entries) {
    const change = v as { old: unknown; new: unknown };
    const sentence = flagFlipSentence(k, change.old, change.new);
    if (sentence) flips.push({ key: k, sentence, newVal: change.new as boolean });
    else regular.push([k, change]);
  }

  return (
    <div className="space-y-3">
      {flips.length > 0 && (
        <div className="space-y-1.5">
          {flips.map(f => (
            <div
              key={f.key}
              className={`inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border ${
                f.newVal
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              {f.sentence}
            </div>
          ))}
        </div>
      )}
      {regular.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {t('audit.changedFields')}
          </div>
          {regular.map(([k, change]) => (
            <div key={k} className="grid grid-cols-3 gap-2 text-sm items-start">
              <span className="text-gray-600 pt-0.5">{humanizeKey(k)}</span>
              <div className="col-span-2 space-y-0.5">
                <div className="flex gap-2 items-baseline">
                  <span className="text-xs text-red-600 font-medium w-10 flex-shrink-0">{t('audit.old')}</span>
                  <span className="text-gray-700 line-through break-all">{formatValue(change.old)}</span>
                </div>
                <div className="flex gap-2 items-baseline">
                  <span className="text-xs text-green-600 font-medium w-10 flex-shrink-0">{t('audit.new')}</span>
                  <span className="text-gray-900 font-medium break-all">{formatValue(change.new)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
