import { useState } from 'react';
import { School } from '../api';

interface Props {
  school: School;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteConfirmModal({ school, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState('');

  const confirmed = typed === school.slug;

  const handleConfirm = async () => {
    if (!confirmed) return;
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Delete School</h2>
              <p className="text-sm text-slate-500">This action cannot be undone.</p>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
            Deleting <strong>{school.name}</strong> will permanently remove all its data:
            <strong> {school.studentCount} students</strong>, <strong>{school.userCount} users</strong>,
            and all associated records.
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Type <span className="font-mono bg-slate-100 px-1 rounded">{school.slug}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono"
              placeholder={school.slug}
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!confirmed || loading}
              className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-red-200 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {loading ? 'Deleting...' : 'Delete School'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
