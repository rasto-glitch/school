import { useState, FormEvent } from 'react';
import {
  updateSchool, resetAdminPassword, School, DEFAULT_FEATURES, SchoolFeatures,
  PREMIUM_ONLY_FEATURES, exportSchoolArchivePdf, exportSchoolArchiveXlsx,
} from '../api';
import { PLANS, PLAN_IDS, PlanId, getPlan, formatMonthlyCost } from '../plans';

interface Props {
  school: School;
  onClose: () => void;
  onUpdated: (school: School) => void;
}

export default function EditSchoolModal({ school, onClose, onUpdated }: Props) {
  const initialPlan = getPlan(school.subscription_plan).id;
  const [form, setForm] = useState({
    name: school.name,
    slug: school.slug,
    abbreviation: school.abbreviation || '',
    primaryColor: school.primary_color,
    secondaryColor: school.secondary_color,
    domain: school.domain || '',
    subscriptionPlan: initialPlan as PlanId,
  });
  const [features, setFeatures] = useState<SchoolFeatures>({ ...DEFAULT_FEATURES, ...school.features });

  const toggleFeature = (key: keyof SchoolFeatures) =>
    setFeatures(f => ({ ...f, [key]: !f[key] }));

  const handlePlanChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const plan = getPlan(e.target.value);
    setForm(f => ({ ...f, subscriptionPlan: plan.id }));
    setFeatures({ ...plan.features });
  };

  const currentPlan = getPlan(form.subscriptionPlan);
  const monthlyCost = formatMonthlyCost(currentPlan, school.studentCount);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showArchivePurgeConfirm, setShowArchivePurgeConfirm] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const archiveWasOn = school.features?.archive === true;
  const archiveTurningOff = archiveWasOn && features.archive !== true;

  const triggerDownload = (blob: Blob, ext: 'pdf' | 'xlsx') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archive-${school.slug}-${new Date().toISOString().split('T')[0]}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await exportSchoolArchivePdf(school.id);
      triggerDownload(res.data, 'pdf');
    } catch {
      setError('Failed to download PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadXlsx = async () => {
    setXlsxBusy(true);
    try {
      const res = await exportSchoolArchiveXlsx(school.id);
      triggerDownload(res.data, 'xlsx');
    } catch {
      setError('Failed to download Excel.');
    } finally {
      setXlsxBusy(false);
    }
  };

  const performUpdate = async (confirmPurge = false) => {
    setError('');
    setLoading(true);
    try {
      const res = await updateSchool(school.id, {
        name: form.name,
        slug: form.slug,
        abbreviation: form.abbreviation,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        domain: form.domain || undefined,
        subscriptionPlan: form.subscriptionPlan,
        features,
        ...(confirmPurge ? { confirmPurge: true } : {}),
      });
      onUpdated({ ...school, ...res.data });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update school.';
      setError(msg);
    } finally {
      setLoading(false);
      setShowArchivePurgeConfirm(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (archiveTurningOff) {
      setShowArchivePurgeConfirm(true);
      return;
    }
    await performUpdate();
  };

  const handleResetPassword = async () => {
    setPwError('');
    setPwSuccess('');
    if (newPassword.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    setPwLoading(true);
    try {
      await resetAdminPassword(school.id, newPassword);
      setPwSuccess('Admin password updated.');
      setNewPassword('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to reset password.';
      setPwError(msg);
    } finally {
      setPwLoading(false);
    }
  };

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Edit School</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">School Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={set('name')} required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Slug <span className="text-red-500">*</span></label>
              <input type="text" value={form.slug} onChange={set('slug')} required pattern="[a-z0-9-]+" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Abbreviation <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(username prefix, e.g. FISK)</span></label>
            <input type="text" value={form.abbreviation} onChange={set('abbreviation')} required maxLength={8} className={`${inputCls} uppercase`} placeholder="FISK" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor} onChange={set('primaryColor')} className="w-9 h-9 rounded cursor-pointer border border-slate-300" />
                <input type="text" value={form.primaryColor} onChange={set('primaryColor')} className={`${inputCls} font-mono text-xs`} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.secondaryColor} onChange={set('secondaryColor')} className="w-9 h-9 rounded cursor-pointer border border-slate-300" />
                <input type="text" value={form.secondaryColor} onChange={set('secondaryColor')} className={`${inputCls} font-mono text-xs`} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Domain <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="text" value={form.domain} onChange={set('domain')} className={inputCls} placeholder="school.example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Plan <span className="text-slate-400 font-normal">(${currentPlan.pricePerStudent}/student/mo)</span>
              </label>
              <select value={form.subscriptionPlan} onChange={handlePlanChange} className={inputCls}>
                {PLAN_IDS.map(id => (
                  <option key={id} value={id}>
                    {PLANS[id].label} — ${PLANS[id].pricePerStudent}/student/mo
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-indigo-700">
              {school.studentCount} student{school.studentCount === 1 ? '' : 's'} × ${currentPlan.pricePerStudent}
            </span>
            <span className="text-sm font-semibold text-indigo-700">{monthlyCost}</span>
          </div>

          {/* Features */}
          <div>
            <p className="text-xs font-medium text-slate-700 mb-2">Features</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(features) as (keyof SchoolFeatures)[]).map(key => {
                const isPremium = (PREMIUM_ONLY_FEATURES as readonly string[]).includes(key);
                return (
                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={features[key]}
                      onChange={() => toggleFeature(key)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700 capitalize">{key.replace(/_/g, ' ')}</span>
                    {isPremium && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                        Premium
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Reset admin password */}
          <div className="border border-slate-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-slate-700">Reset Admin Password</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwError(''); setPwSuccess(''); }}
                placeholder="New password (min 6 chars)"
                className={inputCls}
              />
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={pwLoading || !newPassword}
                className="shrink-0 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-amber-200 text-white text-xs font-medium transition-colors"
              >
                {pwLoading ? '...' : 'Reset'}
              </button>
            </div>
            {pwError && <p className="text-xs text-red-600">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-emerald-600">{pwSuccess}</p>}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-medium transition-colors">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {showArchivePurgeConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold text-slate-900 text-lg mb-2">Disable Archive — irreversible</h3>
            <p className="text-sm text-slate-600 mb-4">
              Turning off the archive feature for <span className="font-medium">{school.name}</span> will
              <span className="font-semibold text-red-600"> permanently delete every archived and graduated student record</span> for this school.
              This cannot be undone. Download a backup first if you might need it.
            </p>

            <div className="flex flex-col gap-2 mb-4">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy || xlsxBusy || loading}
                className="w-full py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              <button
                type="button"
                onClick={downloadXlsx}
                disabled={pdfBusy || xlsxBusy || loading}
                className="w-full py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                {xlsxBusy ? 'Preparing Excel…' : 'Download Excel'}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowArchivePurgeConfirm(false)}
                disabled={loading}
                className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performUpdate(true)}
                disabled={loading || pdfBusy || xlsxBusy}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-red-300 text-white text-sm font-medium transition-colors"
              >
                {loading ? 'Deleting…' : 'Confirm — I have a copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
