import { useState } from 'react';
import Modal from './Modal';
import Select from './Select';
import Button from './Button';

// Shared "remove employee" confirmation that collects an archive reason +
// departure date. Used by teacher/driver removal. The backend snapshots
// these into archived_employees when the school's archive feature is on
// (otherwise it's a hard delete — the copy reflects that ambiguity without
// a per-school feature lookup).

const REASON_OPTIONS = [
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'contract_ended', label: 'Contract ended' },
  { value: 'retired', label: 'Retired' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'other', label: 'Other' },
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
  const today = new Date().toISOString().split('T')[0];
  const [reason, setReason] = useState('resigned');
  const [departureDate, setDepartureDate] = useState(today);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Remove ${entityLabel}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          They will no longer be able to log in. If this school keeps historical
          records, this {entityLabel} is moved to the Archive (recoverable as a
          read-only record); otherwise the removal is permanent.
        </p>

        <Select
          label="Reason"
          options={REASON_OPTIONS}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Departure date</label>
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
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => onConfirm(reason, departureDate || today)}
            className="flex-1"
          >
            Remove {entityLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
