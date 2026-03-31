import { useState, FormEvent } from 'react';
import { createSchool, School, DEFAULT_FEATURES, SchoolFeatures } from '../api';

interface Props {
  onClose: () => void;
  onCreated: (school: School) => void;
}

export default function CreateSchoolModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    abbreviation: '',
    primaryColor: '#4F46E5',
    secondaryColor: '#06B6D4',
    domain: '',
    subscriptionPlan: 'basic',
    adminFirstName: '',
    adminLastName: '',
    adminUsername: '',
    adminPassword: '',
    adminEmail: '',
  });
  const [features, setFeatures] = useState<SchoolFeatures>({ ...DEFAULT_FEATURES });

  const toggleFeature = (key: keyof SchoolFeatures) =>
    setFeatures(f => ({ ...f, [key]: !f[key] }));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const autoSlug = (name: string) =>
    name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const autoAbbrev = (name: string) =>
    name.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 8);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setForm((f) => ({ ...f, name, slug: autoSlug(name), abbreviation: autoAbbrev(name) }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await createSchool({
        name: form.name,
        slug: form.slug,
        abbreviation: form.abbreviation,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        domain: form.domain || undefined,
        subscriptionPlan: form.subscriptionPlan,
        features,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
        adminUsername: form.adminUsername,
        adminPassword: form.adminPassword,
        adminEmail: form.adminEmail || undefined,
      });
      onCreated(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create school.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalWrapper title="Create New School" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Section label="School Details">
          <div className="grid grid-cols-2 gap-3">
            <Field label="School Name" required>
              <input type="text" value={form.name} onChange={handleNameChange} required className={inputCls} placeholder="Green Valley Academy" />
            </Field>
            <Field label="Slug" required hint="URL identifier">
              <input type="text" value={form.slug} onChange={set('slug')} required pattern="[a-z0-9-]+" className={inputCls} placeholder="green-valley" />
            </Field>
          </div>
          <Field label="Abbreviation" required hint="Prefix for all usernames, e.g. GVA → gva_username">
            <input type="text" value={form.abbreviation} onChange={set('abbreviation')} required maxLength={8} className={`${inputCls} uppercase`} placeholder="GVA" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Primary Color">
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor} onChange={set('primaryColor')} className="w-9 h-9 rounded cursor-pointer border border-slate-300" />
                <input type="text" value={form.primaryColor} onChange={set('primaryColor')} className={`${inputCls} font-mono text-xs`} />
              </div>
            </Field>
            <Field label="Secondary Color">
              <div className="flex items-center gap-2">
                <input type="color" value={form.secondaryColor} onChange={set('secondaryColor')} className="w-9 h-9 rounded cursor-pointer border border-slate-300" />
                <input type="text" value={form.secondaryColor} onChange={set('secondaryColor')} className={`${inputCls} font-mono text-xs`} />
              </div>
            </Field>
            <Field label="Plan">
              <select value={form.subscriptionPlan} onChange={set('subscriptionPlan')} className={inputCls}>
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </Field>
          </div>
          <Field label="Domain (optional)" hint="e.g. school.example.com">
            <input type="text" value={form.domain} onChange={set('domain')} className={inputCls} placeholder="school.example.com" />
          </Field>
        </Section>

        <Section label="Admin Account">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required>
              <input type="text" value={form.adminFirstName} onChange={set('adminFirstName')} required className={inputCls} placeholder="John" />
            </Field>
            <Field label="Last Name" required>
              <input type="text" value={form.adminLastName} onChange={set('adminLastName')} required className={inputCls} placeholder="Doe" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" required hint={form.abbreviation ? `will be saved as ${form.abbreviation.toLowerCase()}_username` : ''}>
              <input type="text" value={form.adminUsername} onChange={set('adminUsername')} required className={inputCls} placeholder="admin" />
            </Field>
            <Field label="Password" required>
              <input type="password" value={form.adminPassword} onChange={set('adminPassword')} required minLength={6} className={inputCls} placeholder="Min 6 characters" />
            </Field>
          </div>
          <Field label="Email (optional)">
            <input type="email" value={form.adminEmail} onChange={set('adminEmail')} className={inputCls} placeholder="admin@school.com" />
          </Field>
        </Section>

        <Section label="Features">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(features) as (keyof SchoolFeatures)[]).map(key => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={features[key]}
                  onChange={() => toggleFeature(key)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700 capitalize">{key.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </Section>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-medium transition-colors">
            {loading ? 'Creating...' : 'Create School'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ── shared helpers ──────────────────────────────────────────────────────────

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{label}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
