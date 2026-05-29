// Archived employees view inside the legacy /admin/archive page. Renders
// the search + filter chrome and a grid of employee cards; clicking a card
// opens the shared ArchivedEmployeeDetailModal which handles the detail
// fetch, Restore, and Download JSON actions.

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Archive, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ArchivedEmployeeDetailModal from '../../components/admin/employees/ArchivedEmployeeDetailModal';
import type { ArchivedEmployeeListItem } from '../../types';

// values are i18n keys, resolved with t() at render
const ROLE_LABEL: Record<string, string> = {
  teacher: 'admin.arch_emp.role_teacher',
  driver: 'admin.arch_emp.role_driver',
  supervisor: 'admin.arch_emp.role_supervisor',
  staff: 'admin.arch_emp.role_staff',
  admin: 'admin.arch_emp.role_admin',
};
const ROLE_COLOR: Record<string, string> = {
  teacher: 'bg-indigo-100 text-indigo-700',
  driver: 'bg-cyan-100 text-cyan-700',
  supervisor: 'bg-violet-100 text-violet-700',
  staff: 'bg-emerald-100 text-emerald-700',
  admin: 'bg-purple-100 text-purple-700',
};
const REASON_LABEL: Record<string, string> = {
  resigned: 'admin.arch_emp.reason_resigned',
  terminated: 'admin.arch_emp.reason_terminated',
  contract_ended: 'admin.arch_emp.reason_contract_ended',
  retired: 'admin.arch_emp.reason_retired',
  transferred: 'admin.arch_emp.reason_transferred',
  other: 'admin.arch_emp.reason_other',
};

const ROLE_FILTERS = [
  { value: 'teacher', label: 'admin.arch_emp.filter_teachers' },
  { value: 'driver', label: 'admin.arch_emp.filter_drivers' },
  { value: 'supervisor', label: 'admin.arch_emp.filter_supervisors' },
  { value: 'admin', label: 'admin.arch_emp.filter_administration' },
  { value: 'staff', label: 'admin.arch_emp.filter_staff' },
];

const fmt = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

export default function ArchivedEmployeesTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ArchivedEmployeeListItem[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 400);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.getArchivedEmployees({
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(reasonFilter ? { reason: reasonFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })
      .then(r => setRows(r.data || []))
      .finally(() => setLoading(false));
  }, [roleFilter, reasonFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-48">
          <Input
            placeholder={t('admin.arch_emp.search_ph')}
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            options={ROLE_FILTERS.map(f => ({ value: f.value, label: t(f.label) }))}
            placeholder={t('admin.arch_emp.all_roles')}
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            options={[
              { value: 'resigned', label: t('admin.arch_emp.reason_resigned') },
              { value: 'terminated', label: t('admin.arch_emp.reason_terminated') },
              { value: 'contract_ended', label: t('admin.arch_emp.reason_contract_ended') },
              { value: 'retired', label: t('admin.arch_emp.reason_retired') },
              { value: 'transferred', label: t('admin.arch_emp.reason_transferred') },
              { value: 'other', label: t('admin.arch_emp.reason_other') },
            ]}
            placeholder={t('admin.arch_emp.all_reasons')}
            value={reasonFilter}
            onChange={e => setReasonFilter(e.target.value)}
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-400">
            {t('admin.arch_emp.records_count', { count: rows.length })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <Archive className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">{t('admin.arch_emp.none')}</p>
          <p className="text-xs text-gray-400 mt-1">
            {t('admin.arch_emp.none_hint')}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(e => (
            <button key={e.id} onClick={() => setSelectedId(e.id)} className="text-left w-full">
              <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-600 font-bold text-sm">{e.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{e.fullName}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[e.role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABEL[e.role] ? t(ROLE_LABEL[e.role]) : e.role}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(REASON_LABEL[e.reason] ? t(REASON_LABEL[e.reason]) : e.reason)} · {t('admin.arch_emp.left')} {fmt(e.departureDate)}
                    </p>
                    {(e.position || e.subject) && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{e.position || e.subject}</p>
                    )}
                  </div>
                  <FileText className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <ArchivedEmployeeDetailModal
        employeeId={selectedId}
        onClose={() => setSelectedId(null)}
        onRestored={load}
      />
    </div>
  );
}
