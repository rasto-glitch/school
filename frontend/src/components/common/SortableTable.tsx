// Generic sortable table. Each column declares how to render itself and
// (optionally) how to extract a sortable value. Click on a sortable header
// cycles through asc / desc; passing onRowClick makes whole rows clickable.

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import Card from './Card';
import EmptyState from './EmptyState';

export interface SortableColumn<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  /** If present, the column is sortable; the returned value is compared. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
}

interface Props<T> {
  columns: SortableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
}

function compare(a: unknown, b: unknown): number {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
}

export default function SortableTable<T>({
  columns, rows, rowKey, onRowClick, emptyMessage, emptyDescription, defaultSort,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string>(defaultSort?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.dir ?? 'asc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const cmp = compare(col.sortValue!(a), col.sortValue!(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, sortDir, columns]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  if (rows.length === 0) {
    return <EmptyState title={emptyMessage ?? 'No records'} description={emptyDescription} />;
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`text-left px-3 py-2 text-xs font-medium text-gray-500 ${col.headerClassName ?? ''}`}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-gray-700"
                    >
                      {col.label}
                      {sortKey === col.key
                        ? sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                        : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(row => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-gray-50 last:border-0 ${onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
              >
                {columns.map(col => (
                  <td key={col.key} className={`px-3 py-2 ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
