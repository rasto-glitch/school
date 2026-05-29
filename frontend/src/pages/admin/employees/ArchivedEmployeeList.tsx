// Archived employees list for one role sub-tab. Server-side filters by role
// where supported by the archive schema; opens the shared detail modal on
// row click for Restore + Download JSON actions.
//
// Note: the archived_employees table buckets roles as
// 'teacher | driver | supervisor | staff | admin' — reception and accountant
// share the 'admin' bucket today, so those sub-tabs surface a note and the
// admin bucket as a fallback.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { format, parseISO } from 'date-fns';
import { Search } from 'lucide-react';
import { adminApi } from '../../../services/api';
import { useDebounce } from '../../../hooks/useDebounce';
import Input from '../../../components/common/Input';
import Select from '../../../components/common/Select';
import LoadingSpinner from '../../../components/common/LoadingSpinner';
import SortableTable, { type SortableColumn } from '../../../components/common/SortableTable';
import ArchivedEmployeeDetailModal from '../../../components/admin/employees/ArchivedEmployeeDetailModal';
import type { ArchivedEmployeeListItem } from '../../../types';
import type { EmployeeRole } from '../../../types/employeeRecords';

const fmt = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

interface Props {
  role: EmployeeRole;
}

function mapToArchiveBucket(role: EmployeeRole): string {
  // The archive schema only knows these five buckets.
  if (role === 'teacher' || role === 'staff' || role === 'supervisor' || role === 'admin') return role;
  // Reception and accountant fold into 'admin' in the archive.
  return 'admin';
}

export default function ArchivedEmployeeList({ role }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ArchivedEmployeeListItem[]>([]);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 350);
  const [reasonFilter, setReasonFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const archiveRole = mapToArchiveBucket(role);
  const isFallback = archiveRole !== role; // reception / accountant

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.getArchivedEmployees({
        role: archiveRole,
        ...(debounced ? { search: debounced } : {}),
        ...(reasonFilter ? { reason: reasonFilter } : {}),
      });
      setRows((r.data || []) as ArchivedEmployeeListItem[]);
    } catch {
      toast.error(t('admin.arch_emp.failed_load', 'Failed to load archived'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [archiveRole, debounced, reasonFilter]);

  const columns: SortableColumn<ArchivedEmployeeListItem>[] = useMemo(() => [
    {
      key: 'avatar',
      label: '',
      headerClassName: 'w-12',
      render: r => (
        <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
          {r.fullName?.[0]?.toUpperCase() || '?'}
        </div>
      ),
    },
    {
      key: 'name',
      label: t('admin.list.col_name', 'Name'),
      render: r => <span className="font-medium text-gray-900">{r.fullName || '—'}</span>,
      sortValue: r => r.fullName,
    },
    {
      key: 'reason',
      label: t('admin.list.col_reason', 'Reason'),
      render: r => <span className="text-gray-700">{t(`admin.arch_emp.reason_${r.reason}`, r.reason)}</span>,
      sortValue: r => r.reason,
    },
    {
      key: 'position',
      label: t('admin.list.col_role_extra', 'Position / Subject'),
      render: r => <span className="text-gray-600">{r.position || r.subject || '—'}</span>,
      sortValue: r => r.position || r.subject || '',
    },
    {
      key: 'departureDate',
      label: t('admin.list.col_departed', 'Departed'),
      render: r => <span className="text-gray-600 whitespace-nowrap">{fmt(r.departureDate)}</span>,
      sortValue: r => r.departureDate || '',
    },
  ], [t]);

  return (
    <div className="space-y-3">
      {isFallback && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {t('admin.list.archive_fallback_note', 'Archived reception and accountant records are stored under Administrator. The list below shows the admin archive bucket.')}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={t('admin.list.search_ph', 'Search…')}
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="sm:w-48">
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
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><LoadingSpinner /></div>
      ) : (
        <SortableTable<ArchivedEmployeeListItem>
          rows={rows}
          columns={columns}
          rowKey={r => r.id}
          onRowClick={r => setSelectedId(r.id)}
          emptyMessage={t('admin.arch_emp.none')}
          emptyDescription={t('admin.arch_emp.none_hint')}
          defaultSort={{ key: 'departureDate', dir: 'desc' }}
        />
      )}

      <ArchivedEmployeeDetailModal
        employeeId={selectedId}
        onClose={() => setSelectedId(null)}
        onRestored={() => { setSelectedId(null); load(); }}
      />
    </div>
  );
}
