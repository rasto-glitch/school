import { useState, useEffect, useCallback } from 'react';
import { getSchools, toggleSchoolStatus, deleteSchool, verifySchoolIntegrity, School } from '../api';
import { getPlan, formatMonthlyCost } from '../plans';
import CreateSchoolModal from '../components/CreateSchoolModal';
import EditSchoolModal from '../components/EditSchoolModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import MasterHeader from '../components/MasterHeader';
import type { MasterView } from '../App';

interface Props {
  onLogout: () => void;
  currentView: MasterView;
  onNavigate: (view: MasterView) => void;
}

export default function SchoolsPage({ onLogout, currentView, onNavigate }: Props) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<School | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<School | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchSchools = useCallback(async () => {
    try {
      setError('');
      const res = await getSchools();
      setSchools(res.data);
    } catch {
      setError('Failed to load schools. Check your Supabase credentials.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchools(); }, [fetchSchools]);

  const handleToggleStatus = async (school: School) => {
    setTogglingId(school.id);
    try {
      const res = await toggleSchoolStatus(school.id, !school.is_active);
      setSchools((prev) => prev.map((s) => s.id === school.id ? { ...s, is_active: res.data.is_active } : s));
    } catch {
      alert('Failed to update status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (school: School) => {
    try {
      await deleteSchool(school.id);
      setSchools((prev) => prev.filter((s) => s.id !== school.id));
      setDeleteTarget(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete school.';
      alert(msg);
    }
  };

  const totalStudents = schools.reduce((acc, s) => acc + s.studentCount, 0);
  const activeCount = schools.filter((s) => s.is_active).length;
  const monthlyRevenue = schools
    .filter((s) => s.is_active)
    .reduce((acc, s) => acc + getPlan(s.subscription_plan).pricePerStudent * s.studentCount, 0);
  const filtered = query.trim()
    ? schools.filter((s) =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.slug.toLowerCase().includes(query.toLowerCase())
      )
    : schools;

  return (
    <div className="min-h-screen bg-slate-50">
      <MasterHeader currentView={currentView} onNavigate={onNavigate} onLogout={onLogout} />

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats + action */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex gap-4">
            <StatCard label="Total Schools" value={schools.length} color="bg-indigo-50 text-indigo-700" />
            <StatCard label="Active" value={activeCount} color="bg-emerald-50 text-emerald-700" />
            <StatCard label="Inactive" value={schools.length - activeCount} color="bg-red-50 text-red-700" />
            <StatCard label="Total Students" value={totalStudents} color="bg-sky-50 text-sky-700" />
            <StatCard label="Monthly Revenue" value={`$${monthlyRevenue.toLocaleString()}`} color="bg-violet-50 text-violet-700" />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New School
          </button>
        </div>

        {/* Search */}
        {schools.length > 0 && (
          <div className="mb-5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or slug…"
              className="w-full max-w-sm border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Content */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
        )}

        {!loading && !error && schools.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-lg font-medium">No schools yet</p>
            <p className="text-sm mt-1">Click "New School" to get started.</p>
          </div>
        )}

        {!loading && schools.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <p className="col-span-full text-sm text-slate-400 py-8 text-center">No schools match "{query}".</p>
            )}
            {filtered.map((school) => (
              <SchoolCard
                key={school.id}
                school={school}
                toggling={togglingId === school.id}
                onEdit={() => setEditTarget(school)}
                onToggle={() => handleToggleStatus(school)}
                onDelete={() => setDeleteTarget(school)}
              />
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateSchoolModal
          onClose={() => setShowCreate(false)}
          onCreated={(s) => { setSchools((prev) => [{ ...s, studentCount: 0, adminCount: 1, userCount: 1 }, ...prev]); setShowCreate(false); }}
        />
      )}

      {editTarget && (
        <EditSchoolModal
          school={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={(updated) => {
            setSchools((prev) => prev.map((s) => s.id === updated.id ? { ...s, ...updated } : s));
            setEditTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          school={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${color}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-80">{label}</div>
    </div>
  );
}

function SchoolCard({
  school, toggling, onEdit, onToggle, onDelete,
}: {
  school: School;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const onVerify = async () => {
    setVerifying(true);
    try {
      const { data } = await verifySchoolIntegrity(school.id);
      if (data.ok) {
        alert(`✅ ${school.name}: archive & audit chain intact.` +
          (data.unhashedCount ? `\n(${data.unhashedCount} pre-019 record(s) without a baseline hash.)` : ''));
      } else {
        const lines = data.issues.filter(i => i.kind !== 'unhashed')
          .map(i => `• ${i.kind} — ${i.table_name} ${i.row_id} (${i.detail})`).join('\n');
        alert(`⛔ ${school.name}: ${data.tamperedCount} tampered/broken record(s)!\n\n${lines}`);
      }
    } catch (e: any) {
      alert(`Integrity check failed: ${e?.response?.data?.error || e.message}`);
    } finally {
      setVerifying(false);
    }
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Color bar */}
      <div className="h-2 flex">
        <div className="flex-1" style={{ backgroundColor: school.primary_color }} />
        <div className="flex-1" style={{ backgroundColor: school.secondary_color }} />
      </div>

      <div className="p-4">
        {/* Name + status */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="font-semibold text-slate-900 text-base leading-tight">{school.name}</h2>
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
            school.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
          }`}>
            {school.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <p className="text-xs text-slate-400 font-mono mb-3">{school.slug}</p>

        {/* Stats */}
        <div className="flex gap-3 text-sm mb-4">
          <Stat icon="👥" label={`${school.studentCount} students`} />
          <Stat icon="⚙️" label={`${school.adminCount} admin${school.adminCount !== 1 ? 's' : ''}`} />
          <Stat icon="👤" label={`${school.userCount} users`} />
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {(() => {
            const plan = getPlan(school.subscription_plan);
            return (
              <>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${planBadgeCls(plan.id)}`}>{plan.label}</span>
                <span className="text-xs text-slate-600 font-medium">
                  {formatMonthlyCost(plan, school.studentCount)}
                </span>
                <span className="text-xs text-slate-400">
                  ({school.studentCount} × ${plan.pricePerStudent})
                </span>
              </>
            );
          })()}
          {school.domain && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono ml-auto">{school.domain}</span>
          )}
        </div>

        {/* Colors */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-slate-400">Colors:</span>
          <div className="flex gap-1 items-center">
            <span className="w-4 h-4 rounded-full border border-slate-200" style={{ backgroundColor: school.primary_color }} title={school.primary_color} />
            <span className="w-4 h-4 rounded-full border border-slate-200" style={{ backgroundColor: school.secondary_color }} title={school.secondary_color} />
          </div>
          <span className="text-xs text-slate-300 font-mono">{school.primary_color} · {school.secondary_color}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-slate-100">
          <button
            onClick={onEdit}
            className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onToggle}
            disabled={toggling}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              school.is_active
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
            }`}
          >
            {toggling ? '...' : school.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={onVerify}
            disabled={verifying}
            title="Recompute snapshot hashes + audit chain (tamper check)"
            className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors disabled:opacity-50"
          >
            {verifying ? '...' : 'Verify'}
          </button>
          <button
            onClick={onDelete}
            className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function planBadgeCls(plan: 'basic' | 'pro' | 'premium'): string {
  if (plan === 'premium') return 'bg-violet-100 text-violet-700';
  if (plan === 'pro') return 'bg-indigo-100 text-indigo-700';
  return 'bg-slate-100 text-slate-600';
}

function Stat({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="text-slate-500 text-xs flex items-center gap-1">
      <span>{icon}</span> {label}
    </span>
  );
}
