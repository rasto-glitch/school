import { useState, FormEvent } from 'react';
import { updateSchool, School } from '../api';

interface Props {
  school: School;
  onClose: () => void;
  onUpdated: (school: School) => void;
}

export default function EditSchoolModal({ school, onClose, onUpdated }: Props) {
  const [form, setForm] = useState({
    name: school.name,
    slug: school.slug,
    primaryColor: school.primary_color,
    secondaryColor: school.secondary_color,
    domain: school.domain || '',
    subscriptionPlan: school.subscription_plan || 'basic',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await updateSchool(school.id, {
        name: form.name,
        slug: form.slug,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        domain: form.domain || undefined,
        subscriptionPlan: form.subscriptionPlan,
      });
      onUpdated({ ...school, ...res.data });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update school.';
      setError(msg);
    } finally {
      setLoading(false);
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Plan</label>
              <select value={form.subscriptionPlan} onChange={set('subscriptionPlan')} className={inputCls}>
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
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
    </div>
  );
}
