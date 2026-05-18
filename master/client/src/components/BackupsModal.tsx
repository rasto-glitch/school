import { useEffect, useState, useCallback } from 'react';
import { listSchoolBackups, verifySchoolBackup, School, ArchiveBackup } from '../api';

interface Props {
  school: School;
  onClose: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-700',
  unverified: 'bg-slate-100 text-slate-600',
  failed: 'bg-red-100 text-red-700',
  missing: 'bg-red-100 text-red-700',
};

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupsModal({ school, onClose }: Props) {
  const [rows, setRows] = useState<ArchiveBackup[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    listSchoolBackups(school.id).then(r => setRows(r.data)).catch(() => setRows([]));
  }, [school.id]);
  useEffect(() => { load(); }, [load]);

  const verify = async (id: string) => {
    setBusyId(id);
    try {
      const { data } = await verifySchoolBackup(school.id, id);
      if (data.status !== 'verified') alert(`Backup ${data.status}: ${data.detail}`);
      load();
    } catch (e: any) {
      alert(`Verify failed: ${e?.response?.data?.error || e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Retained backups — {school.name}</h2>
            <p className="text-xs text-slate-500">Pre-purge &amp; manual backups. Verify re-downloads, re-hashes &amp; parses the file.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {rows === null ? (
            <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No retained backups for this school.</p>
          ) : (
            <div className="space-y-2">
              {rows.map(b => (
                <div key={b.id} className="border border-slate-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-800">
                          {new Date(b.created_at).toLocaleString()}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{b.kind}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_STYLE[b.verify_status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {b.verify_status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {b.student_count ?? 0} students · {b.employee_count ?? 0} employees · {fmtBytes(b.byte_size)}
                        {b.verified_at && ` · checked ${new Date(b.verified_at).toLocaleDateString()}`}
                      </div>
                      {b.verify_detail && (
                        <div className="text-xs text-slate-400 mt-0.5 font-mono break-all">{b.verify_detail}</div>
                      )}
                      <div className="text-[10px] text-slate-300 mt-0.5 font-mono break-all">
                        sha256 {b.sha256 ?? '—'}
                      </div>
                    </div>
                    <button
                      onClick={() => verify(b.id)}
                      disabled={busyId === b.id}
                      className="text-xs font-medium py-1.5 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {busyId === b.id ? '...' : 'Verify'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 text-right">
          <button onClick={onClose} className="text-sm font-medium py-2 px-4 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
