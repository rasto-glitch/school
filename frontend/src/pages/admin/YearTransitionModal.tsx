import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowRight as Arrow,
  CheckCircle, GraduationCap, Loader2, Search, X,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { adminApi } from '../../services/api';
import Button from '../../components/common/Button';

interface Props {
  currentYear: string;
  onClose: () => void;
  onDone: (newYear: string) => void;
}

// i18n keys; resolved with t() at render.
const STEPS = ['admin.year_transition.step_review', 'admin.year_transition.step_graduate', 'admin.year_transition.step_promote', 'admin.year_transition.step_confirm'];

export default function YearTransitionModal({ currentYear, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Step 2 — graduation
  const [gradSelected, setGradSelected] = useState<Set<string>>(new Set());
  const [gradSearch, setGradSearch] = useState('');
  const [gradClassFilter, setGradClassFilter] = useState('');

  // Step 3 — promotion (auto next class)
  const [promoSelected, setPromoSelected] = useState<Set<string>>(new Set());
  const [promoSearch, setPromoSearch] = useState('');
  const [promoClassFilter, setPromoClassFilter] = useState('');

  // Step 4 — confirm
  const [newYear, setNewYear] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      adminApi.getAllStudents(),
      adminApi.getClasses(),
    ]).then(([sRes, cRes]) => {
      setStudents(sRes.data?.students || []);
      setClasses(cRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  // Class name lookup by id
  const classById = useMemo(() => {
    const map: Record<string, any> = {};
    classes.forEach(c => { map[c.id] = c; });
    return map;
  }, [classes]);

  // Unique current-class options (for filters)
  const classFilterOptions = useMemo(() =>
    [...new Set(students.map(s => s.classes?.name).filter(Boolean))].sort(),
    [students]);

  // Continuing students (not graduating)
  const continuingStudents = useMemo(
    () => students.filter(s => !gradSelected.has(s.id)),
    [students, gradSelected]);

  // Students who cannot be promoted (no next class configured)
  const noNextClassStudents = useMemo(
    () => continuingStudents.filter(s => !s.classes?.nextClassId),
    [continuingStudents]);

  // ── Step 2 filtered list ──
  const gradFiltered = useMemo(() => students.filter(s => {
    const name = s.fullName || s.full_name || '';
    return (!gradSearch || name.toLowerCase().includes(gradSearch.toLowerCase()))
      && (!gradClassFilter || s.classes?.name === gradClassFilter);
  }), [students, gradSearch, gradClassFilter]);

  // ── Step 3 filtered list ──
  const promoFiltered = useMemo(() => continuingStudents.filter(s => {
    const name = s.fullName || s.full_name || '';
    return (!promoSearch || name.toLowerCase().includes(promoSearch.toLowerCase()))
      && (!promoClassFilter || s.classes?.name === promoClassFilter);
  }), [continuingStudents, promoSearch, promoClassFilter]);

  // ── Toggle helpers ──
  const toggleGrad = (id: string) =>
    setGradSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAllGrad = () => {
    const ids = gradFiltered.map(s => s.id);
    const allOn = ids.every(id => gradSelected.has(id));
    setGradSelected(prev => {
      const n = new Set(prev);
      allOn ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id));
      return n;
    });
  };

  // Only allow selecting promotable (those with nextClassId) in step 3
  const togglePromo = (id: string, hasNext: boolean) => {
    if (!hasNext) return;
    setPromoSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAllPromo = () => {
    const ids = promoFiltered.filter(s => s.classes?.nextClassId).map(s => s.id);
    const allOn = ids.every(id => promoSelected.has(id));
    setPromoSelected(prev => {
      const n = new Set(prev);
      allOn ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id));
      return n;
    });
  };

  const visiblePromoHasNext = promoFiltered.filter(s => s.classes?.nextClassId);

  // ── Confirm submit ──
  const confirm = async () => {
    if (!newYear.trim()) { toast.error(t('admin.year_transition.enter_year')); return; }
    setSubmitting(true);
    try {
      // Build class assignments from promoSelected — each student's nextClassId
      const classAssignments = Array.from(promoSelected).map(id => {
        const st = students.find(s => s.id === id);
        return { studentId: id, classId: st?.classes?.nextClassId };
      }).filter(a => a.classId);

      await adminApi.yearTransition({
        newAcademicYear: newYear.trim(),
        studentIdsToGraduate: Array.from(gradSelected),
        classAssignments,
      });

      const parts = [];
      if (gradSelected.size) parts.push(t('admin.year_transition.n_graduated', { count: gradSelected.size }));
      if (classAssignments.length) parts.push(t('admin.year_transition.n_promoted', { count: classAssignments.length }));
      toast.success(t('admin.year_transition.transitioned', { year: newYear.trim() }) + (parts.length ? ` · ${parts.join(', ')}` : ''));
      onDone(newYear.trim());
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.year_transition.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const gradVisibleAllChecked = gradFiltered.length > 0 && gradFiltered.every(s => gradSelected.has(s.id));
  const promoVisibleAllChecked = visiblePromoHasNext.length > 0 && visiblePromoHasNext.every(s => promoSelected.has(s.id));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">{t('admin.year_transition.title')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('admin.year_transition.step_of', { step, total: STEPS.length })}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 flex-shrink-0">
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <div key={n} className="flex items-center gap-1 flex-shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  n < step ? 'bg-green-500 text-white' : n === step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-400'
                }`}>
                  {n < step ? <CheckCircle className="w-3.5 h-3.5" /> : n}
                </div>
                <span className={`text-xs whitespace-nowrap ${n === step ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{t(label)}</span>
                {n < STEPS.length && <div className="w-5 h-px bg-gray-200 mx-1" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step 1: Review ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-primary-50 rounded-xl p-4 flex items-center gap-3">
                <GraduationCap className="w-8 h-8 text-primary-600 flex-shrink-0" />
                <div>
                  <p className="text-xs text-primary-500 font-medium uppercase">{t('admin.year_transition.current_year')}</p>
                  <p className="text-xl font-bold text-primary-700">{currentYear || t('admin.year_transition.not_set')}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">{t('admin.year_transition.wizard_will')}</p>
                <ul className="space-y-2 text-sm text-gray-600">
                  {[
                    t('admin.year_transition.will_graduate'),
                    t('admin.year_transition.will_promote'),
                    t('admin.year_transition.will_clear'),
                    t('admin.year_transition.will_advance'),
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t('admin.year_transition.loading')}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-800">{students.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{t('admin.year_transition.active_students')}</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-orange-500">{students.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{t('admin.year_transition.reports_cleared')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Graduate students ── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    className="w-full border border-gray-300 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('admin.year_transition.search_students')}
                    value={gradSearch}
                    onChange={e => setGradSearch(e.target.value)}
                  />
                </div>
                <select
                  className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  value={gradClassFilter}
                  onChange={e => setGradClassFilter(e.target.value)}
                >
                  <option value="">{t('admin.year_transition.all_classes')}</option>
                  {classFilterOptions.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {t('admin.year_transition.n_shown', { count: gradFiltered.length })}
                  {gradSelected.size > 0 && <span className="text-primary-600 font-medium"> · {t('admin.year_transition.n_selected_grad', { count: gradSelected.size })}</span>}
                </p>
                <button onClick={toggleAllGrad} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                  {gradVisibleAllChecked ? t('admin.year_transition.deselect_visible') : t('admin.year_transition.select_visible')}
                </button>
              </div>

              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
              ) : gradFiltered.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">{t('admin.year_transition.no_students_match')}</p>
              ) : (
                <div className="space-y-1.5">
                  {gradFiltered.map(st => {
                    const name = st.fullName || st.full_name || '';
                    const cls = st.classes?.name || '';
                    const checked = gradSelected.has(st.id);
                    return (
                      <label key={st.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        checked ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleGrad(st.id)}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                        <div className="w-7 h-7 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-700 font-bold text-xs">{name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                          {cls && <p className="text-xs text-gray-400">{cls}</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Promote to next class ── */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                <Trans i18nKey="admin.year_transition.promote_intro" components={{ b: <span className="font-semibold text-gray-800" /> }} />
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    className="w-full border border-gray-300 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={t('admin.year_transition.search_students')}
                    value={promoSearch}
                    onChange={e => setPromoSearch(e.target.value)}
                  />
                </div>
                <select
                  className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  value={promoClassFilter}
                  onChange={e => setPromoClassFilter(e.target.value)}
                >
                  <option value="">{t('admin.year_transition.all_classes')}</option>
                  {classFilterOptions.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {t('admin.year_transition.n_shown', { count: promoFiltered.length })}
                  {promoSelected.size > 0 && <span className="text-green-600 font-medium"> · {t('admin.year_transition.n_promoted_will', { count: promoSelected.size })}</span>}
                </p>
                {visiblePromoHasNext.length > 0 && (
                  <button onClick={toggleAllPromo} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                    {promoVisibleAllChecked ? t('admin.year_transition.deselect_visible') : t('admin.year_transition.select_visible')}
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
              ) : promoFiltered.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">{t('admin.year_transition.no_continuing_match')}</p>
              ) : (
                <div className="space-y-1.5">
                  {promoFiltered.map(st => {
                    const name = st.fullName || st.full_name || '';
                    const currentCls = st.classes?.name || '—';
                    const nextClassId = st.classes?.nextClassId;
                    const nextCls = nextClassId ? classById[nextClassId]?.name : null;
                    const hasNext = !!nextCls;
                    const checked = promoSelected.has(st.id);
                    return (
                      <label key={st.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                        !hasNext ? 'border-gray-200 opacity-50 cursor-not-allowed' :
                        checked ? 'border-green-400 bg-green-50 cursor-pointer' :
                        'border-gray-200 hover:border-gray-300 cursor-pointer'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!hasNext}
                          onChange={() => togglePromo(st.id, hasNext)}
                          className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:opacity-40"
                        />
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${hasNext ? 'bg-gray-100' : 'bg-gray-100'}`}>
                          <span className="text-gray-600 font-bold text-xs">{name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                          <p className="text-xs flex items-center gap-1">
                            <span className="text-gray-400">{currentCls}</span>
                            {hasNext ? (
                              <>
                                <Arrow className="w-3 h-3 text-green-500" />
                                <span className="text-green-600 font-medium">{nextCls}</span>
                              </>
                            ) : (
                              <span className="text-amber-500 font-medium">· {t('admin.year_transition.no_next_class')}</span>
                            )}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {noNextClassStudents.length > 0 && !promoClassFilter && !promoSearch && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {t('admin.year_transition.no_next_warning', { count: noNextClassStudents.length })}
                </p>
              )}
            </div>
          )}

          {/* ── Step 4: Confirm ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin.year_transition.new_year')}</label>
                <input
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g. 2025-2026"
                  value={newYear}
                  onChange={e => setNewYear(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.year_transition.summary')}</p>
                <ul className="space-y-1.5 text-sm text-gray-700">
                  <li>
                    <Trans i18nKey="admin.year_transition.sum_graduated" values={{ count: gradSelected.size, from: currentYear ? t('admin.year_transition.from_year', { year: currentYear }) : '' }} components={{ b: <span className="font-semibold text-primary-600" /> }} />
                  </li>
                  <li>
                    <Trans i18nKey="admin.year_transition.sum_promoted" values={{ count: promoSelected.size }} components={{ b: <span className="font-semibold text-green-600" /> }} />
                  </li>
                  <li>
                    <Trans i18nKey="admin.year_transition.sum_cleared" values={{ count: continuingStudents.length }} components={{ b: <span className="font-semibold text-orange-500" /> }} />
                  </li>
                  <li>
                    <Trans i18nKey="admin.year_transition.sum_advance" values={{ year: newYear.trim() || '—' }} components={{ b: <span className="font-semibold text-gray-900" /> }} />
                  </li>
                </ul>
              </div>

              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 space-y-1.5">
                  <p><span className="font-semibold">{t('admin.year_transition.cannot_undo')}</span></p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <Trans i18nKey="admin.year_transition.warn_reports" values={{ count: continuingStudents.length }} components={{ b: <span className="font-semibold" /> }} />
                    </li>
                    <li>
                      {t('admin.year_transition.warn_graduating', { count: gradSelected.size })}
                    </li>
                    <li>
                      {t('admin.year_transition.warn_classes')}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> {t('common.back')}
            </button>
          ) : (
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
              {t('common.cancel')}
            </button>
          )}

          {step < STEPS.length ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              icon={<ArrowRight className="w-4 h-4" />}
              disabled={step === 1 && loading}
            >
              {t('admin.year_transition.next')}
            </Button>
          ) : (
            <Button
              onClick={confirm}
              loading={submitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {t('admin.year_transition.confirm_transition')}
            </Button>
          )}
        </div>

      </div>
    </div>
  );
}
