// Read-only emergency-contacts view for the archived profile page.
// Card grid mirrors the live EmergencyContactsTab layout but drops the
// edit / delete buttons.

import { useTranslation } from 'react-i18next';
import { Phone, Mail, MapPin } from 'lucide-react';
import Card from '../../../common/Card';
import EmptyState from '../../../common/EmptyState';
import type { EmergencyContact } from '../../../../types/employeeRecords';

interface Props {
  contacts: EmergencyContact[];
}

export default function ArchivedEmergencyView({ contacts }: Props) {
  const { t } = useTranslation();

  if (contacts.length === 0) {
    return <EmptyState title={t('admin.ec.empty')} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {contacts.map(c => (
        <Card key={c.id}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">#{c.priority}</span>
            <p className="font-semibold text-gray-900">{c.fullName}</p>
          </div>
          {c.relationship && <p className="text-sm text-gray-600">{c.relationship}</p>}
          {c.phone && (
            <p className="text-sm text-gray-700 flex items-center gap-1 mt-1">
              <Phone className="w-3 h-3 text-gray-400" /> {c.phone}{c.altPhone && ` · ${c.altPhone}`}
            </p>
          )}
          {c.email && (
            <p className="text-sm text-gray-700 flex items-center gap-1 mt-1">
              <Mail className="w-3 h-3 text-gray-400" /> {c.email}
            </p>
          )}
          {c.address && (
            <p className="text-sm text-gray-600 flex items-start gap-1 mt-1">
              <MapPin className="w-3 h-3 text-gray-400 mt-0.5" /> {c.address}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
