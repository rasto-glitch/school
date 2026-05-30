// Read-only acknowledgements view for the archived profile page.
// Shows the past signatures only — no policy status (archived employees
// can't sign new ones).

import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Card from '../../../common/Card';
import EmptyState from '../../../common/EmptyState';
import type { ArchivedAcknowledgementRecord } from '../../../../types/employeeRecords';

interface Props {
  acknowledgements: ArchivedAcknowledgementRecord[];
}

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

export default function ArchivedAcknowledgementsView({ acknowledgements }: Props) {
  const { t } = useTranslation();

  if (acknowledgements.length === 0) {
    return <EmptyState title={t('admin.ack.empty')} />;
  }

  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_policy')}</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_status')}</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.ack.col_signed')}</th>
          </tr>
        </thead>
        <tbody>
          {acknowledgements.map(a => (
            <tr key={a.id} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-900">{a.policyKey}</span>
                  <span className="text-[10px] text-gray-400">v{a.policyVersion}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="w-3 h-3" />{t('admin.ack.status_signed')}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(a.acknowledgedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
