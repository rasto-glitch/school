import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { CalendarDays, Settings, Tag, Trash2, Plus, Layers, Image as ImageIcon, GraduationCap } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import YearTransitionModal from './YearTransitionModal';
import ChatScheduleCard from './ChatScheduleCard';
import type { MarkType, Term } from '../../types';

const APPLIES_OPTIONS = [
  { value: 'both', label: 'Reports & Grades' },
  { value: 'report', label: 'Reports only' },
  { value: 'grade', label: 'Grades only' },
];

function appliesLabel(v: string) {
  return APPLIES_OPTIONS.find(o => o.value === v)?.label ?? v;
}

function appliesBadgeColor(v: string) {
  if (v === 'report') return 'bg-purple-50 text-purple-700';
  if (v === 'grade') return 'bg-amber-50 text-amber-700';
  return 'bg-blue-50 text-blue-700';
}

export default function SettingsPage() {
  const { school, setAuth, token, refreshToken, user, rememberMe } = useAuthStore() as any;
  const feat = (key: string) => school?.features?.[key] !== false;

  const [academicYear, setAcademicYear] = useState('');
  const [editYear, setEditYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const onPickLogo = () => logoInputRef.current?.click();
  const onLogoChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const r = await adminApi.uploadSchoolLogo(file);
      const newLogoUrl = r.data?.logoUrl;
      if (newLogoUrl && school && token && user) {
        setAuth(token, refreshToken, user, { ...school, logoUrl: newLogoUrl }, rememberMe);
      }
      toast.success('Logo updated');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  // mark types state
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [markTypesLoading, setMarkTypesLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAppliesTo, setNewAppliesTo] = useState<'report' | 'grade' | 'both'>('both');
  const [addingMark, setAddingMark] = useState(false);

  const [newMax, setNewMax] = useState('');

  // terms state
  const [terms, setTerms] = useState<Term[]>([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [newTermName, setNewTermName] = useState('');
  const [addingTerm, setAddingTerm] = useState(false);

  // GPA grading config
  type BandRow = { minPercent: string; letter: string; gradePoint: string };
  const [gradingMode, setGradingMode] = useState<'scale' | 'gpa' | 'both'>('scale');
  const [bands, setBands] = useState<BandRow[]>([]);
  const [savingGrading, setSavingGrading] = useState(false);

  useEffect(() => {
    setLoading(true);
    adminApi.getSettings()
      .then(r => {
        const y = r.data?.currentAcademicYear || '';
        setAcademicYear(y);
        setEditYear(y);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!feat('grades') && !feat('reports')) return;
    setMarkTypesLoading(true);
    adminApi.getMarkTypes()
      .then(r => setMarkTypes(r.data || []))
      .finally(() => setMarkTypesLoading(false));
    setTermsLoading(true);
    adminApi.getTerms()
      .then(r => setTerms(r.data || []))
      .finally(() => setTermsLoading(false));
    adminApi.getGradeConfig()
      .then(r => {
        setGradingMode(r.data?.mode || 'scale');
        setBands((r.data?.bands || []).map((b: any) => ({
          minPercent: String(b.minPercent), letter: b.letter, gradePoint: String(b.gradePoint),
        })));
      })
      .catch(() => {});
  }, []);

  const saveCorrection = async () => {
    setSaving(true);
    try {
      await adminApi.updateSettings({ currentAcademicYear: editYear });
      setAcademicYear(editYear);
      toast.success('Academic year updated');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addMarkType = async () => {
    if (!newName.trim()) return;
    setAddingMark(true);
    try {
      const r = await adminApi.createMarkType({ name: newName.trim(), appliesTo: newAppliesTo, maxValue: newMax.trim() === '' ? null : Number(newMax) });
      setMarkTypes(prev => [...prev, r.data]);
      setNewName('');
      setNewMax('');
    } catch {
      toast.error('Failed to add mark type');
    } finally {
      setAddingMark(false);
    }
  };

  const deleteMarkType = async (id: string) => {
    try {
      await adminApi.deleteMarkType(id);
      setMarkTypes(prev => prev.filter(m => m.id !== id));
    } catch {
      toast.error('Failed to delete');
    }
  };

  const addTerm = async () => {
    if (!newTermName.trim()) return;
    setAddingTerm(true);
    try {
      const r = await adminApi.createTerm({ name: newTermName.trim() });
      setTerms(prev => [...prev, r.data]);
      setNewTermName('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add term');
    } finally {
      setAddingTerm(false);
    }
  };

  const deleteTerm = async (id: string) => {
    try {
      await adminApi.deleteTerm(id);
      setTerms(prev => prev.filter(t => t.id !== id));
    } catch {
      toast.error('Failed to delete');
    }
  };

  // Persist a mark type's "out of" value (inline edit in the list).
  const saveMarkMax = async (mt: MarkType, raw: string) => {
    const next = raw.trim() === '' ? null : Number(raw);
    if ((mt.maxValue ?? null) === (next ?? null)) return;
    try {
      const r = await adminApi.updateMarkType(mt.id, { maxValue: next });
      setMarkTypes(prev => prev.map(m => m.id === mt.id ? r.data : m));
    } catch {
      toast.error('Failed to update max');
    }
  };

  const DEFAULT_BANDS: BandRow[] = [
    { minPercent: '90', letter: 'A', gradePoint: '4.0' },
    { minPercent: '80', letter: 'B', gradePoint: '3.0' },
    { minPercent: '70', letter: 'C', gradePoint: '2.0' },
    { minPercent: '60', letter: 'D', gradePoint: '1.0' },
    { minPercent: '0', letter: 'F', gradePoint: '0.0' },
  ];
  const updateBand = (i: number, field: keyof BandRow, val: string) =>
    setBands(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: val } : b));
  const addBand = () => setBands(prev => [...prev, { minPercent: '', letter: '', gradePoint: '' }]);
  const removeBand = (i: number) => setBands(prev => prev.filter((_, idx) => idx !== i));

  const saveGrading = async () => {
    setSavingGrading(true);
    try {
      const cleaned = bands
        .filter(b => b.letter.trim() && b.minPercent !== '' && b.gradePoint !== '')
        .map(b => ({ minPercent: Number(b.minPercent), letter: b.letter.trim(), gradePoint: Number(b.gradePoint) }))
        .sort((a, b) => b.minPercent - a.minPercent);
      if (gradingMode !== 'scale' && cleaned.length === 0) {
        toast.error('Add at least one GPA band first.');
        setSavingGrading(false);
        return;
      }
      await adminApi.updateGradingConfig({ mode: gradingMode, bands: cleaned });
      toast.success('Grading settings saved');
    } catch {
      toast.error('Failed to save grading settings');
    } finally {
      setSavingGrading(false);
    }
  };

  const showMarkTypes = feat('grades') || feat('reports');
  const showTerms = feat('grades') || feat('reports');

  return (
    <PageLayout title="Settings" subtitle="School-wide configuration">
      <div className="max-w-lg space-y-6">

        {/* School logo */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon className="w-5 h-5 text-rose-600" />
            <h2 className="font-semibold text-gray-900">School Logo</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Shown in the sidebar and on tuition receipts. Square images work best (PNG or JPG, up to 10 MB).
          </p>
          <div className="flex items-center gap-4">
            {school?.logoUrl ? (
              <img src={school.logoUrl} alt="School logo" className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-gray-400" />
              </div>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onLogoChosen}
            />
            <Button onClick={onPickLogo} loading={logoUploading} variant="outline">
              {school?.logoUrl ? 'Change logo' : 'Upload logo'}
            </Button>
          </div>
        </Card>

        {/* Current academic year */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Academic Year</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Correct the label if it was entered incorrectly. To properly advance the year at the end of term, use the transition wizard below.
          </p>
          {loading ? (
            <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  placeholder="e.g. 2024-2025"
                  value={editYear}
                  onChange={e => setEditYear(e.target.value)}
                />
              </div>
              <Button
                onClick={saveCorrection}
                loading={saving}
                disabled={editYear === academicYear}
              >
                Save
              </Button>
            </div>
          )}
        </Card>

        {/* End-of-year transition wizard */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">End-of-Year Transition</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Run this once at the end of each school year. The wizard will walk you through graduating students, clearing reports, and advancing the academic year — all in one step.
          </p>
          <Button
            onClick={() => setShowWizard(true)}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500"
            icon={<CalendarDays className="w-4 h-4" />}
          >
            Begin Year Transition
          </Button>
        </Card>

        {/* Chat schedule */}
        {feat('chat') && <ChatScheduleCard />}

        {/* Terms */}
        {showTerms && (
          <Card>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-5 h-5 text-sky-600" />
              <h2 className="font-semibold text-gray-900">Terms</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Define the grading terms used by teachers when entering grades. Teachers select from this list as the grading period.
            </p>

            {/* Add new */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <Input
                  placeholder="e.g. Term 1, Mid-term, Q1…"
                  value={newTermName}
                  onChange={e => setNewTermName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTerm(); }}
                />
              </div>
              <Button
                onClick={addTerm}
                loading={addingTerm}
                disabled={!newTermName.trim()}
                icon={<Plus className="w-4 h-4" />}
              >
                Add
              </Button>
            </div>

            {/* List */}
            {termsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : terms.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No terms yet. Add one above.</p>
            ) : (
              <div className="space-y-2">
                {terms.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 rounded-xl">
                    <span className="text-sm font-medium text-gray-800">{t.name}</span>
                    <button
                      onClick={() => deleteTerm(t.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Mark Types */}
        {showMarkTypes && (
          <Card>
            <div className="flex items-center gap-2 mb-1">
              <Tag className="w-5 h-5 text-emerald-600" />
              <h2 className="font-semibold text-gray-900">Mark Types</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Define the mark categories teachers can use when submitting reports and grades. Teachers select from this list when adding marks.
            </p>

            <p className="text-xs text-gray-400 mb-3">
              "Out of" is optional. Set it (e.g. Quiz / 20) to define each mark's maximum — required for accurate percentages and GPA. Leave blank to keep the current behavior.
            </p>

            {/* Add new */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="flex-1 min-w-[140px]">
                <Input
                  placeholder="e.g. Quiz, Oral Exam, Project…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addMarkType(); }}
                />
              </div>
              <input
                type="number"
                placeholder="Out of"
                value={newMax}
                onChange={e => setNewMax(e.target.value)}
                className="input-field w-24 text-sm"
              />
              <select
                value={newAppliesTo}
                onChange={e => setNewAppliesTo(e.target.value as any)}
                className="input-field w-44 text-sm"
              >
                {APPLIES_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button
                onClick={addMarkType}
                loading={addingMark}
                disabled={!newName.trim()}
                icon={<Plus className="w-4 h-4" />}
              >
                Add
              </Button>
            </div>

            {/* List */}
            {markTypesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : markTypes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No mark types yet. Add one above.</p>
            ) : (
              <div className="space-y-2">
                {markTypes.map(mt => (
                  <div key={mt.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 rounded-xl">
                    <span className="text-sm font-medium text-gray-800 flex-1 truncate">{mt.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <span>/</span>
                        <input
                          type="number"
                          defaultValue={mt.maxValue ?? ''}
                          placeholder="—"
                          onBlur={e => saveMarkMax(mt, e.target.value)}
                          className="w-16 px-2 py-1 text-sm rounded-lg border border-gray-200 bg-white text-gray-800"
                        />
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${appliesBadgeColor(mt.appliesTo)}`}>
                        {appliesLabel(mt.appliesTo)}
                      </span>
                      <button
                        onClick={() => deleteMarkType(mt.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* GPA Grading */}
        {feat('grades') && (
          <Card>
            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="w-5 h-5 text-violet-600" />
              <h2 className="font-semibold text-gray-900">GPA Grading</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Choose how grades are shown to parents. GPA is derived from each subject's percentage using the bands below — teachers keep entering marks as usual.
            </p>

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Grading mode</label>
            <select
              value={gradingMode}
              onChange={e => setGradingMode(e.target.value as any)}
              className="input-field w-full text-sm mb-4"
            >
              <option value="scale">Scale only (percentages)</option>
              <option value="gpa">GPA only</option>
              <option value="both">Both (percentage + GPA)</option>
            </select>

            {gradingMode !== 'scale' && (
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Grade bands</label>
                  {bands.length === 0 && (
                    <button onClick={() => setBands(DEFAULT_BANDS)} className="text-xs font-semibold text-primary-600 hover:text-primary-700">
                      Load 4.0 default
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] font-medium text-gray-400 uppercase">
                  <span>Min %</span><span>Letter</span><span>Points</span><span />
                </div>
                {bands.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                    <input type="number" value={b.minPercent} onChange={e => updateBand(i, 'minPercent', e.target.value)} placeholder="90" className="input-field !py-1.5 text-sm" />
                    <input value={b.letter} onChange={e => updateBand(i, 'letter', e.target.value)} placeholder="A" className="input-field !py-1.5 text-sm" />
                    <input type="number" step="0.1" value={b.gradePoint} onChange={e => updateBand(i, 'gradePoint', e.target.value)} placeholder="4.0" className="input-field !py-1.5 text-sm" />
                    <button onClick={() => removeBand(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={addBand} className="flex items-center gap-1 text-sm font-semibold text-primary-600 hover:text-primary-700 mt-1">
                  <Plus className="w-4 h-4" /> Add band
                </button>
              </div>
            )}

            <Button onClick={saveGrading} loading={savingGrading}>Save grading settings</Button>
          </Card>
        )}

      </div>

      {showWizard && (
        <YearTransitionModal
          currentYear={academicYear}
          onClose={() => setShowWizard(false)}
          onDone={newYear => {
            setAcademicYear(newYear);
            setEditYear(newYear);
            setShowWizard(false);
          }}
        />
      )}
    </PageLayout>
  );
}
