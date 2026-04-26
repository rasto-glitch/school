import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { CalendarDays, Settings, Tag, Trash2, Plus, Layers } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import YearTransitionModal from './YearTransitionModal';
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
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

  const [academicYear, setAcademicYear] = useState('');
  const [editYear, setEditYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // mark types state
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [markTypesLoading, setMarkTypesLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAppliesTo, setNewAppliesTo] = useState<'report' | 'grade' | 'both'>('both');
  const [addingMark, setAddingMark] = useState(false);

  // terms state
  const [terms, setTerms] = useState<Term[]>([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [newTermName, setNewTermName] = useState('');
  const [addingTerm, setAddingTerm] = useState(false);

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
      const r = await adminApi.createMarkType({ name: newName.trim(), appliesTo: newAppliesTo });
      setMarkTypes(prev => [...prev, r.data]);
      setNewName('');
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

  const showMarkTypes = feat('grades') || feat('reports');
  const showTerms = feat('grades') || feat('reports');

  return (
    <PageLayout title="Settings" subtitle="School-wide configuration">
      <div className="max-w-lg space-y-6">

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

            {/* Add new */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <Input
                  placeholder="e.g. Quiz, Oral Exam, Project…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addMarkType(); }}
                />
              </div>
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
                    <span className="text-sm font-medium text-gray-800">{mt.name}</span>
                    <div className="flex items-center gap-2">
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
