import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import Select from './Select';
import Button from './Button';

// Shared "remove employee" confirmation that collects an archive reason +
// departure date. Used by teacher/driver removal. The backend snapshots
// these into archived_employees when the school's archive feature is on
// (otherwise it's a hard delete — the copy reflects that ambiguity without
// a per-school feature lookup).

// label holds an i18n key; resolved with t() at render.
const REASON_OPTIONS = [
  { value: 'resigned', label: 'admin.archive_reason.resigned' },
  { value: 'terminated', label: 'admin.archive_reason.terminated' },
  { value: 'contract_ended', label: 'admin.archive_reason.contract_ended' },
  { value: 'retired', label: 'admin.archive_reason.retired' },
  { value: 'transferred', label: 'admin.archive_reason.transferred' },
  { value: 'other', label: 'admin.archive_reason.other' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, departureDate: string) => void;
  busy?: boolean;
  /** e.g. "teacher", "driver" — used in the title/body copy. */
  entityLabel: string;
}

export default function ArchiveReasonModal({ isOpen, onClose, onConfirm, busy, entityLabel }: Props) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];
  const [reason, setReason] = useState('resigned');
  const [departureDate, setDepartureDate] = useState(today);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('admin.archive_reason.title', { entity: entityLabel })} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {t('admin.archive_reason.body', { entity: entityLabel })}
        </p>

        <Select
          label={t('admin.archive_reason.reason')}
          options={REASON_OPTIONS.map(o => ({ value: o.value, label: t(o.label) }))}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin.archive_reason.departure_date')}</label>
          <input
            type="date"
            value={departureDate}
            max={today}
            onChange={e => setDepartureDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1">
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => onConfirm(reason, departureDate || today)}
            className="flex-1"
          >
            {t('admin.archive_reason.title', { entity: entityLabel })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
