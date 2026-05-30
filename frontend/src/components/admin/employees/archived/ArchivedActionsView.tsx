// Read-only HR-actions timeline for the archived profile page. Same
// visual as the live ActionsTab but drops the Add button (archive is
// append-only AND closed).

import { useTranslation } from 'react-i18next';
import { Award, AlertTriangle, Briefcase, MessageSquare, X, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Card from '../../../common/Card';
import EmptyState from '../../../common/EmptyState';
import type { EmployeeAction, ActionKind } from '../../../../types/employeeRecords';

interface Props {
  actions: EmployeeAction[];
}

const KIND_ICON: Record<ActionKind, React.ComponentType<{ className?: string }>> = {
  review: MessageSquare, warning: AlertTriangle, commendation: Award,
  role_change: Briefcase, contract_change: FileText, termination: X,
};
const KIND_COLOR: Record<ActionKind, string> = {
  review: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-700',
  commendation: 'bg-emerald-50 text-emerald-700',
  role_change: 'bg-violet-50 text-violet-700',
  contract_change: 'bg-slate-50 text-slate-700',
  termination: 'bg-rose-50 text-rose-700',
};
const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

export default function ArchivedActionsView({ actions }: Props) {
  const { t } = useTranslation();

  if (actions.length === 0) {
    return <EmptyState title={t('admin.act.empty')} />;
  }

  return (
    <div className="space-y-2">
      {actions.map(a => {
        const Icon = KIND_ICON[a.kind];
        return (
          <Card key={a.id}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${KIND_COLOR[a.kind]}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 text-sm capitalize">{t(`admin.act.kind_${a.kind}`)}</span>
                  <span className="text-xs text-gray-500">{fmtDate(a.occurredOn)}</span>
                  {a.rating != null && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">★ {a.rating}/5</span>
                  )}
                </div>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{a.summary}</p>
                {a.createdByName && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    {t('admin.act.by')} {a.createdByName}
                    {a.createdByRole && ` (${a.createdByRole})`}
                    {' · '}{fmtDate(a.createdAt)}
                  </p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
