import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useDebounce } from '../../hooks/useDebounce';

// Returning-employee prompt for the add-teacher/driver/staff forms. As the
// admin types a name, archived employees of the same role surface so the
// new record can be linked to the previous tenure (previous_archive_id).
// Mirrors the returning-student UX in StudentsManagement. Self-contained:
// reads the archive feature flag, debounces + searches, owns the matches
// list. The parent owns the linked id (to send as previousArchiveId) and
// reacts to onPick/onClear.

export interface ReturningEmployeeCandidate {
  id: string;
  role: string;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  position: string | null;
  subject: string | null;
  hireDate: string | null;
  departureDate: string | null;
  reason: string;
}

interface Props {
  role: 'teacher' | 'driver' | 'staff' | 'supervisor' | 'admin';
  /** The fullName the admin is currently typing. */
  nameQuery: string;
  /** Linked archive id (null when not linked). Owned by the parent. */
  linkedId: string | null;
  linkedLabel: string;
  onPick: (c: ReturningEmployeeCandidate) => void;
  onClear: () => void;
}

export default function ReturningEmployeeSearch({ role, nameQuery, linkedId, linkedLabel, onPick, onClear }: Props) {
  const { t } = useTranslation();
  const archiveEnabled = useAuthStore(s => s.school?.features?.archive === true);
  const debouncedName = useDebounce(nameQuery ?? '', 350);
  const [matches, setMatches] = useState<ReturningEmployeeCandidate[]>([]);

  useEffect(() => {
    if (!archiveEnabled || linkedId) { setMatches([]); return; }
    const name = (debouncedName ?? '').trim();
    if (name.length < 2) { setMatches([]); return; }
    adminApi.searchArchivedEmployees(name, role)
      .then(r => setMatches((r.data ?? []) as ReturningEmployeeCandidate[]))
      .catch(() => setMatches([]));
  }, [debouncedName, archiveEnabled, linkedId, role]);

  if (!archiveEnabled) return null;

  if (linkedId) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
        <History className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-amber-900">{t('admin.returning_emp.linking')}</div>
          <div className="text-amber-800 truncate">{linkedLabel}</div>
        </div>
        <button type="button" onClick={onClear} className="p-1 text-amber-700 hover:bg-amber-100 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (matches.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-center gap-2 text-sm text-amber-900 font-medium mb-2">
        <History className="w-4 h-4" /> {t('admin.returning_emp.matches', { count: matches.length })}
      </div>
      <div className="space-y-1.5">
        {matches.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            className="w-full text-left bg-white hover:bg-amber-100 border border-amber-200 rounded px-3 py-2 text-sm"
          >
            <div className="font-medium text-gray-900">{c.fullName}</div>
            <div className="text-xs text-gray-600">
              {(c.position || c.subject) && <>{c.position || c.subject} · </>}
              {c.reason}{c.departureDate ? ` ${t('admin.returning_emp.on_date', { date: c.departureDate })}` : ''}
            </div>
          </button>
        ))}
      </div>
      <div className="text-xs text-amber-700 mt-2">{t('admin.returning_emp.click_hint')}</div>
    </div>
  );
}
