import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ShieldCheck, Crown, Clock, Save } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import {
  CAPABILITY_META, GROUP_LABELS, PRESET_BUNDLES,
  type Capability, type CapabilityMeta,
} from '../../constants/clearance';

// /admin/clearance — the Owner/HR capability panel (Phase A). Replaces the
// old "HR Officers" screen (hr.read / hr.manage are now just two of the
// twelve capabilities). Owners can toggle anything incl. the Owner bit; an
// hr.manage holder sees every admin but may only toggle the HR∪Operations
// capabilities (the server re-enforces this — disabled toggles here are a
// courtesy, not the gate).

interface AdminRow {
  id: string;
  fullName: string;
  username: string;
  isActive: boolean;
  isOwner: boolean;
  capabilities: Capability[];
  isHrOfficer: boolean;
  pending: boolean;
}

interface Viewer {
  userId: string;
  isOwner: boolean;
  grantableCapabilities: Capability[];
  canGrantOwner: boolean;
}

const GROUPS: CapabilityMeta['group'][] = ['operations', 'hr', 'it', 'finance'];

export default function ClearancePage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // Per-admin local edit state (capabilities + owner) keyed by id. Absent ⇒
  // not being edited (mirrors the server value).
  const [draft, setDraft] = useState<Record<string, { caps: Set<Capability>; owner: boolean }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getClearanceAdmins();
      setAdmins((data?.admins ?? []) as AdminRow[]);
      setViewer((data?.viewer ?? null) as Viewer | null);
      setDraft({});
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.clearance.failed_load', 'Failed to load clearance'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const grantable = useMemo(
    () => new Set<Capability>(viewer?.grantableCapabilities ?? []),
    [viewer],
  );

  // Pending first, then inactive last, then alpha.
  const sorted = useMemo(() => [...admins].sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  }), [admins]);

  const draftFor = (a: AdminRow) =>
    draft[a.id] ?? { caps: new Set(a.capabilities), owner: a.isOwner };

  const isDirty = (a: AdminRow) => {
    const d = draft[a.id];
    if (!d) return false;
    if (d.owner !== a.isOwner) return true;
    const cur = new Set(a.capabilities);
    if (d.caps.size !== cur.size) return true;
    for (const c of d.caps) if (!cur.has(c)) return true;
    return false;
  };

  const mutate = (a: AdminRow, fn: (d: { caps: Set<Capability>; owner: boolean }) => void) => {
    setDraft(prev => {
      const base = prev[a.id] ?? { caps: new Set(a.capabilities), owner: a.isOwner };
      const next = { caps: new Set(base.caps), owner: base.owner };
      fn(next);
      return { ...prev, [a.id]: next };
    });
  };

  const toggleCap = (a: AdminRow, cap: Capability) => {
    if (!grantable.has(cap)) return;
    mutate(a, d => { d.caps.has(cap) ? d.caps.delete(cap) : d.caps.add(cap); });
  };

  const toggleOwner = (a: AdminRow) => {
    if (!viewer?.canGrantOwner) return;
    mutate(a, d => { d.owner = !d.owner; });
  };

  const applyPreset = (a: AdminRow, caps: Capability[]) => {
    mutate(a, d => { caps.forEach(c => { if (grantable.has(c)) d.caps.add(c); }); });
  };

  const save = async (a: AdminRow) => {
    const d = draftFor(a);
    setSaving(a.id);
    try {
      await adminApi.updateClearance(a.id, d.owner
        ? { isOwner: true }
        : { isOwner: false, capabilities: Array.from(d.caps) });
      toast.success(t('admin.clearance.saved', 'Clearance updated'));
      await load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.clearance.failed_save', 'Failed to update'));
    } finally { setSaving(null); }
  };

  return (
    <PageLayout title={t('admin.clearance.title', 'Admin clearance')} subtitle={t('admin.clearance.subtitle', 'Grant and revoke administrator access')}>
      <div className="space-y-4">
        <Card className="bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-900">{t('admin.clearance.banner_title', 'Capability-based access')}</p>
              <p className="text-sm text-blue-800 mt-1">
                {viewer?.isOwner
                  ? t('admin.clearance.banner_owner', 'As an owner you can grant any capability, including owner status and read-only finance.')
                  : t('admin.clearance.banner_hr', 'You can grant HR and Operations capabilities. IT, finance, audit, settings and owner status are reserved for owners.')}
              </p>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : sorted.length === 0 ? (
          <EmptyState title={t('admin.clearance.empty', 'No admins')} description={t('admin.clearance.empty_hint', 'Create an admin account to grant clearance.')} />
        ) : (
          <div className="space-y-3">
            {sorted.map(a => {
              const self = a.id === viewer?.userId;
              const d = draftFor(a);
              const dirty = isDirty(a);
              return (
                <Card key={a.id} className={a.isActive ? '' : 'opacity-60'}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{a.fullName}</p>
                        <span className="text-xs text-gray-500">@{a.username}</span>
                        {a.isOwner && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            <Crown className="w-3 h-3" /> {t('admin.clearance.owner_badge', 'Owner')}
                          </span>
                        )}
                        {a.pending && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                            <Clock className="w-3 h-3" /> {t('admin.clearance.pending_badge', 'Pending — cannot log in')}
                          </span>
                        )}
                        {!a.isActive && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('admin.clearance.inactive', 'Inactive')}</span>}
                        {self && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{t('admin.clearance.you', 'You')}</span>}
                      </div>
                    </div>
                    <Button size="sm" icon={<Save className="w-4 h-4" />} onClick={() => save(a)} loading={saving === a.id} disabled={self || !dirty}>
                      {t('admin.clearance.save', 'Save')}
                    </Button>
                  </div>

                  {/* Owner toggle (owners only can set it; never on your own row). */}
                  {viewer?.canGrantOwner && (
                    <label className={`mt-3 flex items-center gap-2 text-sm ${self ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={d.owner}
                        disabled={self}
                        onChange={() => toggleOwner(a)}
                      />
                      <span className="font-medium text-gray-800">{t('admin.clearance.make_owner', 'Owner (all capabilities + read-only finance)')}</span>
                    </label>
                  )}

                  {/* Capability grid — hidden when Owner is on (owner = everything). */}
                  {!d.owner && (
                    <div className="mt-3 space-y-3">
                      {/* Preset shortcuts. */}
                      <div className="flex flex-wrap gap-2">
                        {PRESET_BUNDLES.map(p => {
                          const can = p.capabilities.some(c => grantable.has(c));
                          return (
                            <button
                              key={p.key}
                              type="button"
                              disabled={self || !can}
                              onClick={() => applyPreset(a, p.capabilities)}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              + {t(`admin.clearance.preset_${p.key}`, p.label)}
                            </button>
                          );
                        })}
                      </div>

                      {GROUPS.map(group => {
                        const metas = CAPABILITY_META.filter(m => m.group === group);
                        return (
                          <div key={group}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
                              {t(`admin.clearance.group_${group}`, GROUP_LABELS[group])}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                              {metas.map(m => {
                                const can = grantable.has(m.key);
                                const checked = d.caps.has(m.key);
                                return (
                                  <label
                                    key={m.key}
                                    // capability keys carry a dot (e.g. hr.read); swap to '_'
                                    // so i18next doesn't treat it as a nested path.
                                    title={t(`admin.clearance.cap_${m.key.replace('.', '_')}_desc`, m.description)}
                                    className={`flex items-start gap-2 text-sm py-0.5 ${(!can || self) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="rounded border-gray-300 mt-0.5"
                                      checked={checked}
                                      disabled={!can || self}
                                      onChange={() => toggleCap(a, m.key)}
                                    />
                                    <span className="text-gray-800">{t(`admin.clearance.cap_${m.key.replace('.', '_')}`, m.label)}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
